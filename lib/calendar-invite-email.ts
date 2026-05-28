export type CalendarInviteMessage = {
  from?: string;
  subject?: string;
  bodyHtml?: string;
  attachments?: { filename: string; mimeType: string }[];
};

export type CalendarInviteParsed = {
  title: string;
  when?: string;
  organizer?: string;
  organizerEmail?: string;
  guests: string[];
  meetLink?: string;
  viewEventLink?: string;
  rsvp: {
    yes?: string;
    no?: string;
    maybe?: string;
    moreOptions?: string;
  };
  replyForEmail?: string;
};

const INVITATION_SUBJECT_RE =
  /^(?:invitation|updated invitation|cancelled event|accepted|declined|tentatively accepted):\s*/i;

/** Drive / Docs / Sheets share notifications (not calendar events). */
const WORKSPACE_SHARE_SUBJECT_RE =
  /^(?:spreadsheet|document|file|folder|presentation|form) shared with you\b/i;

const WORKSPACE_SHARE_FROM_RE =
  /(?:drive-shares-dm-noreply|doclist-noreply|documentcomment|mail-noreply)@google\.com/i;

const WORKSPACE_SHARE_HTML_RE =
  /docs\.google\.com\/(?:spreadsheets|document|presentation|forms)|drive\.google\.com\/(?:file|open|folders)/i;

/** Google Drive, Docs, or Sheets share emails — must not use the calendar invite card. */
export function isGoogleWorkspaceShareNotification(msg: CalendarInviteMessage): boolean {
  const from = msg.from || "";
  if (WORKSPACE_SHARE_FROM_RE.test(from)) return true;
  if (/via Google (?:Sheets|Docs|Drive)/i.test(from)) return true;
  const subj = (msg.subject || "").trim();
  if (WORKSPACE_SHARE_SUBJECT_RE.test(subj)) return true;
  const html = msg.bodyHtml || "";
  if (WORKSPACE_SHARE_HTML_RE.test(html)) return true;
  if (/shared a (?:spreadsheet|document|presentation|folder|file)/i.test(html)) return true;
  if (/has invited you to (?:edit|view|comment on) the following (?:spreadsheet|document|file)/i.test(html)) {
    return true;
  }
  return false;
}

/** Detect Google Calendar invitation emails (list + reading pane). */
export function isCalendarInvite(msg: CalendarInviteMessage): boolean {
  if (isGoogleWorkspaceShareNotification(msg)) return false;

  const from = (msg.from || "").toLowerCase();
  if (from.includes("calendar-notification@google.com")) return true;
  if (from.includes("@group.calendar.google.com")) return true;
  if (
    (msg.attachments ?? []).some(
      (a) => /invite\.ics$/i.test(a.filename) || /^text\/calendar/i.test(a.mimeType)
    )
  ) {
    return true;
  }
  const subj = msg.subject || "";
  if (INVITATION_SUBJECT_RE.test(subj)) return true;
  const html = msg.bodyHtml || "";
  // Footer text like "Invitation from Google Calendar" appears on many Google
  // emails — require an actual calendar event link, not generic branding.
  if (html.includes("calendar.google.com/calendar/event")) return true;
  if (/href="https:\/\/calendar\.google\.com\/calendar\/event/i.test(html)) return true;
  if (
    html.includes("meet.google.com/") &&
    (INVITATION_SUBJECT_RE.test(subj) || html.includes("calendar.google.com/calendar/event"))
  ) {
    return true;
  }
  return false;
}

export function isCalendarInviteThread(t: {
  subject?: string;
  from?: string;
  snippet?: string;
}): boolean {
  return isCalendarInvite({
    from: t.from,
    subject: t.subject,
    bodyHtml: t.snippet,
  });
}

export function stripInvitationSubjectPrefix(subject: string): string {
  return subject.replace(INVITATION_SUBJECT_RE, "").trim() || subject.trim() || "(no title)";
}

/** Decode Google Calendar `eid` query param to raw event id. */
export function extractCalendarEventId(bodyHtml?: string): string | null {
  if (!bodyHtml) return null;
  const m = bodyHtml.match(/[?&]eid=([A-Za-z0-9_\-=%]+)/);
  if (!m) return null;
  try {
    const raw = decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/");
    const pad = raw.length % 4 ? raw + "=".repeat(4 - (raw.length % 4)) : raw;
    const decoded = atob(pad);
    const eventId = decoded.split(" ")[0];
    return eventId || null;
  } catch {
    return null;
  }
}

function htmlToPlainLines(html: string): string[] {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function sectionAfterLabel(lines: string[], label: string, stopLabels: string[]): string | undefined {
  const idx = lines.findIndex((l) => l.toLowerCase() === label.toLowerCase());
  if (idx < 0) return undefined;
  const parts: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (stopLabels.some((s) => line.toLowerCase() === s.toLowerCase())) break;
    if (/^reply for /i.test(line)) break;
    if (/^join with /i.test(line)) break;
    if (/^invitation from /i.test(line)) break;
    parts.push(line);
  }
  return parts.join(" ").trim() || undefined;
}

function findHref(html: string, patterns: RegExp[]): string | undefined {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1].replace(/&amp;/g, "&");
  }
  return undefined;
}

function findRsvpLink(html: string, label: "Yes" | "No" | "Maybe"): string | undefined {
  const re = new RegExp(
    `href="(https://calendar\\.google\\.com/calendar/event[^"]*)"[^>]*>\\s*${label}\\s*<`,
    "i"
  );
  const m = html.match(re);
  if (m?.[1]) return m[1].replace(/&amp;/g, "&");
  const re2 = new RegExp(`href="([^"]*action=RESPOND[^"]*)"[^>]*>[\\s\\S]*?${label}`, "i");
  const m2 = html.match(re2);
  return m2?.[1]?.replace(/&amp;/g, "&");
}

/** Parse Gmail/Google Calendar invitation HTML into structured fields. */
export function parseCalendarInviteHtml(
  html: string,
  subject: string
): CalendarInviteParsed | null {
  if (!html && !subject) return null;

  const lines = htmlToPlainLines(html);
  const title = stripInvitationSubjectPrefix(subject);

  const when =
    sectionAfterLabel(lines, "When", ["Organizer", "Guests", "Meeting link", "Join", "Reply"]) ||
    lines.find((l) => /\d{4}/.test(l) && /(\d{1,2}(:\d{2})?\s*(am|pm)|–|—)/i.test(l));

  const organizerBlock = sectionAfterLabel(lines, "Organizer", ["Guests", "Meeting link", "Reply"]);
  let organizer: string | undefined;
  let organizerEmail: string | undefined;
  if (organizerBlock) {
    const emailMatch = organizerBlock.match(/[\w.+-]+@[\w.-]+\.\w+/);
    organizerEmail = emailMatch?.[0];
    organizer = organizerBlock.replace(/[\w.+-]+@[\w.-]+\.\w+/, "").trim() || organizerEmail;
  }

  const guestsStart = lines.findIndex((l) => l.toLowerCase() === "guests");
  const guests: string[] = [];
  if (guestsStart >= 0) {
    for (let i = guestsStart + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^view all guest info$/i.test(line)) continue;
      if (
        ["reply", "meeting link", "join with google meet", "more options"].some((s) =>
          line.toLowerCase().startsWith(s)
        )
      ) {
        break;
      }
      if (/^reply for /i.test(line)) break;
      guests.push(line);
    }
  }

  const meetLink =
    findHref(html, [
      /href="(https:\/\/meet\.google\.com\/[a-z0-9-]+)"/i,
      /(https:\/\/meet\.google\.com\/[a-z0-9-]+)/i,
    ]) || lines.find((l) => /^meet\.google\.com\//i.test(l) || l.includes("meet.google.com/"));

  const viewEventLink = findHref(html, [
    /href="(https:\/\/calendar\.google\.com\/calendar\/event[^"]+)"/i,
  ]);

  const replyLine = lines.find((l) => /^reply for /i.test(l));
  const replyForEmail = replyLine?.match(/reply for\s+(.+)/i)?.[1]?.trim();

  return {
    title,
    when,
    organizer,
    organizerEmail,
    guests,
    meetLink: meetLink?.startsWith("http") ? meetLink : meetLink ? `https://${meetLink}` : undefined,
    viewEventLink,
    rsvp: {
      yes: findRsvpLink(html, "Yes"),
      no: findRsvpLink(html, "No"),
      maybe: findRsvpLink(html, "Maybe"),
      moreOptions: findHref(html, [
        /href="(https:\/\/calendar\.google\.com\/calendar\/event[^"]*action=VIEW[^"]*)"/i,
        /href="(https:\/\/calendar\.google\.com\/calendar\/event[^"]*)"/i,
      ]),
    },
    replyForEmail,
  };
}

/** True when we have enough structure to render the Gmail-style invite card. */
export function hasCalendarInviteCardData(parsed: CalendarInviteParsed | null): boolean {
  if (!parsed) return false;
  if (parsed.rsvp.yes || parsed.rsvp.no || parsed.rsvp.maybe || parsed.meetLink || parsed.viewEventLink) {
    return true;
  }
  if (parsed.when && (parsed.organizer || parsed.guests.length > 0)) return true;
  return false;
}

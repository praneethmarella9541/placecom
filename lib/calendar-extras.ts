/**
 * The optional event settings beyond title/time/guests — reminders, guest permissions,
 * visibility, busy/free, Drive attachments — as one shape the form, the API routes and the
 * Google calls share. `sanitizeExtras` is what the routes run on untrusted request bodies.
 */

export type ReminderMethod = "popup" | "email";
export type EventReminders = { useDefault: boolean; overrides?: { method: ReminderMethod; minutes: number }[] };
export type EventAttachment = { fileUrl: string; title?: string; mimeType?: string; fileId?: string };
export type Visibility = "default" | "public" | "private" | "confidential";
export type Transparency = "opaque" | "transparent";

export type EventExtras = {
  reminders?: EventReminders;
  visibility?: Visibility;
  /** "opaque" = show as busy, "transparent" = show as free. */
  transparency?: Transparency;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  attachments?: EventAttachment[];
};

/** Google's limits. */
export const MAX_REMINDERS = 5;
export const MAX_REMINDER_MINUTES = 40320; // 4 weeks
export const MAX_ATTACHMENTS = 25;

const VISIBILITIES: Visibility[] = ["default", "public", "private", "confidential"];
const METHODS: ReminderMethod[] = ["popup", "email"];
const ATTACHMENT_HOSTS = new Set(["drive.google.com", "docs.google.com"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keep only well-formed settings from a request body; anything else is dropped, never trusted. */
export function sanitizeExtras(raw: unknown): EventExtras {
  const out: EventExtras = {};
  if (!isObj(raw)) return out;

  if (isObj(raw.reminders)) {
    const r = raw.reminders;
    if (r.useDefault === true) out.reminders = { useDefault: true };
    else if (Array.isArray(r.overrides)) {
      const overrides = r.overrides
        .filter(isObj)
        .map((o) => ({ method: o.method as ReminderMethod, minutes: Number(o.minutes) }))
        .filter(
          (o) =>
            METHODS.includes(o.method) &&
            Number.isInteger(o.minutes) &&
            o.minutes >= 0 &&
            o.minutes <= MAX_REMINDER_MINUTES
        )
        .slice(0, MAX_REMINDERS);
      out.reminders = { useDefault: false, overrides };
    }
  }
  if (typeof raw.visibility === "string" && VISIBILITIES.includes(raw.visibility as Visibility)) {
    out.visibility = raw.visibility as Visibility;
  }
  if (raw.transparency === "opaque" || raw.transparency === "transparent") out.transparency = raw.transparency;
  for (const k of ["guestsCanModify", "guestsCanInviteOthers", "guestsCanSeeOtherGuests"] as const) {
    if (typeof raw[k] === "boolean") out[k] = raw[k] as boolean;
  }
  if (Array.isArray(raw.attachments)) {
    const files: EventAttachment[] = [];
    for (const a of raw.attachments.filter(isObj)) {
      if (typeof a.fileUrl !== "string") continue;
      let host = "";
      try {
        const u = new URL(a.fileUrl);
        if (u.protocol !== "https:") continue;
        host = u.hostname;
      } catch {
        continue;
      }
      if (!ATTACHMENT_HOSTS.has(host)) continue; // only Drive/Docs files can be attached to an event
      files.push({
        fileUrl: a.fileUrl,
        ...(typeof a.title === "string" ? { title: a.title.slice(0, 200) } : {}),
        ...(typeof a.mimeType === "string" ? { mimeType: a.mimeType.slice(0, 120) } : {}),
        ...(typeof a.fileId === "string" ? { fileId: a.fileId.slice(0, 200) } : {}),
      });
      if (files.length >= MAX_ATTACHMENTS) break;
    }
    out.attachments = files;
  }
  return out;
}

/** The extras as Google event fields. */
export function extrasToPayload(extras: EventExtras | undefined): Record<string, unknown> {
  if (!extras) return {};
  const p: Record<string, unknown> = {};
  if (extras.reminders) p.reminders = extras.reminders.useDefault ? { useDefault: true } : { useDefault: false, overrides: extras.reminders.overrides ?? [] };
  if (extras.visibility) p.visibility = extras.visibility;
  if (extras.transparency) p.transparency = extras.transparency;
  if (extras.guestsCanModify !== undefined) p.guestsCanModify = extras.guestsCanModify;
  if (extras.guestsCanInviteOthers !== undefined) p.guestsCanInviteOthers = extras.guestsCanInviteOthers;
  if (extras.guestsCanSeeOtherGuests !== undefined) p.guestsCanSeeOtherGuests = extras.guestsCanSeeOtherGuests;
  if (extras.attachments !== undefined) p.attachments = extras.attachments;
  return p;
}

/* ── The form's view of the settings ──────────────────────────────────── */

/** Everything the "more options" section edits, as plain form state. */
export type EventOptions = {
  /** IANA zone the start/end times are entered in. */
  timeZone: string;
  /** false = Google's default reminders for the calendar. */
  customReminders: boolean;
  reminders: { method: ReminderMethod; minutes: number }[];
  visibility: Visibility;
  transparency: Transparency;
  guestsCanModify: boolean;
  guestsCanInviteOthers: boolean;
  guestsCanSeeOtherGuests: boolean;
  attachments: EventAttachment[];
};

export function defaultOptions(timeZone: string): EventOptions {
  return {
    timeZone,
    customReminders: false,
    reminders: [{ method: "popup", minutes: 10 }],
    visibility: "default",
    transparency: "opaque",
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: true,
    attachments: [],
  };
}

/** The pieces of a Google event the form reads its starting options from. */
export type EventOptionsSource = {
  start?: { timeZone?: string };
  reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] };
  visibility?: string;
  transparency?: string;
  guestsCanModify?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanSeeOtherGuests?: boolean;
  attachments?: { fileUrl?: string; title?: string; mimeType?: string; fileId?: string }[];
};

/** Form options for an existing event (Google's own defaults where the event doesn't say). */
export function optionsFromEvent(ev: EventOptionsSource, fallbackZone: string): EventOptions {
  const base = defaultOptions(ev.start?.timeZone || fallbackZone);
  const overrides = (ev.reminders?.overrides ?? []).filter(
    (o): o is { method: ReminderMethod; minutes: number } =>
      (o.method === "popup" || o.method === "email") && typeof o.minutes === "number"
  );
  return {
    ...base,
    customReminders: ev.reminders?.useDefault === false,
    reminders: ev.reminders?.useDefault === false ? overrides : base.reminders,
    visibility: VISIBILITIES.includes(ev.visibility as Visibility) ? (ev.visibility as Visibility) : "default",
    transparency: ev.transparency === "transparent" ? "transparent" : "opaque",
    guestsCanModify: ev.guestsCanModify ?? false,
    // Google's defaults when the field is absent.
    guestsCanInviteOthers: ev.guestsCanInviteOthers ?? true,
    guestsCanSeeOtherGuests: ev.guestsCanSeeOtherGuests ?? true,
    attachments: (ev.attachments ?? [])
      .filter((a) => !!a.fileUrl)
      .map((a) => ({ fileUrl: a.fileUrl!, title: a.title, mimeType: a.mimeType, fileId: a.fileId })),
  };
}

/** The settings to send to the API. */
export function optionsToExtras(o: EventOptions): EventExtras {
  return {
    reminders: o.customReminders
      ? { useDefault: false, overrides: o.reminders.slice(0, MAX_REMINDERS) }
      : { useDefault: true },
    visibility: o.visibility,
    transparency: o.transparency,
    guestsCanModify: o.guestsCanModify,
    guestsCanInviteOthers: o.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: o.guestsCanSeeOtherGuests,
    attachments: o.attachments,
  };
}

/** "10 minutes before", "1 hour before", "2 days before" … */
export function reminderLabel(minutes: number): string {
  if (minutes === 0) return "At the start";
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"} before`;
  if (minutes % 10080 === 0) return unit(minutes / 10080, "week");
  if (minutes % 1440 === 0) return unit(minutes / 1440, "day");
  if (minutes % 60 === 0) return unit(minutes / 60, "hour");
  return unit(minutes, "minute");
}

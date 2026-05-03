import "server-only";

const FIREFLIES_API_URL = "https://api.fireflies.ai/graphql";

export async function inviteFirefliesBot(meetingUrl: string): Promise<boolean> {
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIREFLIES_API_KEY");
  }

  // NOTE: This is a representative GraphQL mutation for inviting Fireflies to a meeting.
  // The exact schema might require a title or start time depending on the Fireflies tier.
  const query = `
    mutation inviteBotToMeeting($meetingUrl: String!) {
      addToLiveMeeting(meeting_link: $meetingUrl, title: "Interview Meeting") {
        message
      }
    }
  `;

  const res = await fetch(FIREFLIES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { meetingUrl },
    }),
  });

  if (!res.ok) {
    throw new Error(`Fireflies API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.errors) {
    console.error("Fireflies GraphQL errors:", json.errors);
    throw new Error(json.errors[0]?.message || "Fireflies GraphQL error");
  }

  return true;
}

export type FirefliesSummary = {
  overview?: string | null;
  action_items?: string | null;
  short_summary?: string | null;
  shorthand_bullet?: string | null;
  gist?: string | null;
};

export type FirefliesTranscriptListItem = {
  id: string;
  title?: string | null;
  meeting_link?: string | null;
  participants?: string[] | null;
  is_live?: boolean | null;
  date?: number | null;
  meeting_attendees?: { email?: string | null }[] | null;
  meeting_info?: { summary_status?: string | null } | null;
  summary?: FirefliesSummary | null;
};

type FirefliesGqlResponse<T> = { data?: T; errors?: { message: string }[] };

const FIREFLIES_GQL_TIMEOUT_MS = Math.min(
  Math.max(Number(process.env.FIREFLIES_GQL_TIMEOUT_MS) || 45000, 5000),
  120000
);

async function firefliesGraphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const apiKey = process.env.FIREFLIES_API_KEY;
  if (!apiKey) {
    throw new Error("Missing FIREFLIES_API_KEY");
  }

  const res = await fetch(FIREFLIES_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(FIREFLIES_GQL_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Fireflies API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as FirefliesGqlResponse<T>;
  if (json.errors?.length) {
    const msg = json.errors.map((e) => e.message).join("; ");
    throw new Error(msg || "Fireflies GraphQL error");
  }
  if (!json.data) {
    throw new Error("Fireflies returned empty data");
  }
  return json.data;
}

/** Stable comparison key for Meet/Zoom/etc. links (hostname + path + sorted query). */
export function normalizeMeetingUrlKey(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    const keys = Array.from(u.searchParams.keys()).sort();
    const qs = keys.map((k) => `${k}=${u.searchParams.get(k) ?? ""}`).join("&");
    return qs ? `${host}${path}?${qs}` : `${host}${path}`;
  } catch {
    return s.toLowerCase().replace(/\/+$/, "");
  }
}

/** Google Meet segment after /meet.google.com/ (lowercase). */
export function googleMeetCode(url: string): string | null {
  const m = url.match(/meet\.google\.com\/([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

export function collectParticipantEmails(t: FirefliesTranscriptListItem): Set<string> {
  const out = new Set<string>();
  for (const p of t.participants || []) {
    const e = typeof p === "string" ? p.trim().toLowerCase() : "";
    if (e.includes("@")) out.add(e);
  }
  for (const a of t.meeting_attendees || []) {
    const e = a?.email?.trim().toLowerCase();
    if (e?.includes("@")) out.add(e);
  }
  return out;
}

export function formatFirefliesSummary(summary: FirefliesSummary | null | undefined): string {
  if (!summary) return "";
  const parts: string[] = [];
  const ov = summary.overview?.trim();
  const ss = summary.short_summary?.trim();
  const gist = summary.gist?.trim();
  const bullets = summary.shorthand_bullet?.trim();
  const ai = summary.action_items?.trim();
  if (ov) parts.push(`Overview:\n${ov}`);
  if (ss && ss !== ov) parts.push(`Summary:\n${ss}`);
  if (gist && gist !== ov && gist !== ss) parts.push(`Gist:\n${gist}`);
  if (bullets) parts.push(`Notes:\n${bullets}`);
  if (ai) parts.push(`Action items:\n${ai}`);
  return parts.join("\n\n").trim();
}

function transcriptHasUsableSummary(t: FirefliesTranscriptListItem): boolean {
  const text = formatFirefliesSummary(t.summary ?? undefined);
  return text.length >= 40;
}

export function isTranscriptReadyForSync(t: FirefliesTranscriptListItem): boolean {
  if (t.is_live) return false;
  const status = t.meeting_info?.summary_status?.toLowerCase();
  if (status === "failed" || status === "skipped") return false;
  if (status === "processed") return true;
  return transcriptHasUsableSummary(t);
}

const LIST_TRANSCRIPTS_QUERY = `
query ListTranscriptsForSync($fromDate: DateTime, $limit: Int, $skip: Int) {
  transcripts(fromDate: $fromDate, limit: $limit, skip: $skip) {
    id
    title
    meeting_link
    participants
    is_live
    date
    meeting_attendees { email }
    meeting_info { summary_status }
    summary {
      overview
      action_items
      short_summary
      shorthand_bullet
      gist
    }
  }
}
`;

export async function listTranscriptsPage(
  fromDateIso: string | undefined,
  limit: number,
  skip: number
): Promise<FirefliesTranscriptListItem[]> {
  type Row = { transcripts: FirefliesTranscriptListItem[] | null };
  const variables: Record<string, unknown> = { limit, skip };
  if (fromDateIso) variables.fromDate = fromDateIso;
  const data = await firefliesGraphql<Row>(LIST_TRANSCRIPTS_QUERY, variables);
  return data.transcripts ?? [];
}

const TRANSCRIPT_DETAIL_QUERY = `
query TranscriptDetailForSync($transcriptId: String!) {
  transcript(id: $transcriptId) {
    id
    sentences {
      speaker_name
      text
      raw_text
    }
    summary {
      overview
      action_items
      short_summary
      shorthand_bullet
      gist
    }
    meeting_info { summary_status }
    is_live
  }
}
`;

export async function fetchTranscriptDetailForSync(transcriptId: string): Promise<{
  summaryText: string;
  transcriptText: string;
  summaryStatus: string | null;
  isLive: boolean;
}> {
  type Row = {
    transcript: {
      id: string;
      sentences?: { speaker_name?: string | null; text?: string | null; raw_text?: string | null }[];
      summary?: FirefliesSummary | null;
      meeting_info?: { summary_status?: string | null } | null;
      is_live?: boolean | null;
    } | null;
  };
  const data = await firefliesGraphql<Row>(TRANSCRIPT_DETAIL_QUERY, { transcriptId });
  const t = data.transcript;
  if (!t) {
    throw new Error("Transcript not found");
  }
  const sentences = t.sentences || [];
  const maxChars = Math.min(
    Math.max(Number(process.env.FIREFLIES_SYNC_MAX_TRANSCRIPT_CHARS) || 200_000, 20_000),
    500_000
  );
  let transcriptText = "";
  for (const s of sentences) {
    const line = (s.text || s.raw_text || "").trim();
    const name = (s.speaker_name || "").trim();
    if (!line) continue;
    const block = name ? `${name}: ${line}` : line;
    const sep = transcriptText ? "\n\n" : "";
    const next = transcriptText + sep + block;
    if (next.length <= maxChars) {
      transcriptText = next;
      continue;
    }
    const room = maxChars - transcriptText.length - sep.length;
    if (room > 120) {
      transcriptText += sep + block.slice(0, room) + "\n\n[Transcript truncated for storage.]";
    } else if (!transcriptText) {
      transcriptText =
        block.slice(0, Math.max(0, maxChars - 40)) + "\n\n[Transcript truncated for storage.]";
    } else {
      transcriptText += "\n\n[Transcript truncated for storage.]";
    }
    break;
  }

  const summaryText = formatFirefliesSummary(t.summary ?? undefined);

  return {
    summaryText,
    transcriptText,
    summaryStatus: t.meeting_info?.summary_status ?? null,
    isLive: !!t.is_live,
  };
}

export function transcriptMatchesRecording(
  t: FirefliesTranscriptListItem,
  recording: {
    meeting_url: string;
    fireflies_id?: string | null;
    attendee_email?: string | null;
    created_at?: string;
  }
): boolean {
  if (recording.fireflies_id && t.id === recording.fireflies_id) return true;

  const urlR = (recording.meeting_url || "").trim();
  const urlT = (t.meeting_link || "").trim();

  if (urlT && urlR) {
    if (normalizeMeetingUrlKey(urlT) === normalizeMeetingUrlKey(urlR)) return true;
    const ct = googleMeetCode(urlT);
    const cr = googleMeetCode(urlR);
    if (ct && cr && ct === cr) return true;
  }

  const att = (recording.attendee_email || "").trim().toLowerCase();
  if (!att || !collectParticipantEmails(t).has(att)) return false;

  if (!urlT && recording.created_at != null && t.date != null) {
    const recMs = new Date(recording.created_at).getTime();
    if (!Number.isFinite(recMs)) return false;
    return Math.abs(t.date - recMs) < 72 * 60 * 60 * 1000;
  }

  return false;
}

/**
 * Page through Fireflies transcripts (max 50 per request) until empty or maxPages.
 */
export async function fetchRecentTranscripts(options: {
  fromDateIso?: string;
  maxPages?: number;
  /** Return true to stop paging early (e.g. all pending meetings already have a ready match). */
  shouldStop?: (accumulated: FirefliesTranscriptListItem[]) => boolean;
}): Promise<FirefliesTranscriptListItem[]> {
  const maxPages = options.maxPages ?? 12;
  const limit = 50;
  const all: FirefliesTranscriptListItem[] = [];

  for (let page = 0; page < maxPages; page++) {
    const batch = await listTranscriptsPage(options.fromDateIso, limit, page * limit);
    if (!batch.length) break;
    all.push(...batch);
    if (options.shouldStop?.(all)) break;
    if (batch.length < limit) break;
  }

  return all;
}

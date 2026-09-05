import "server-only";

import { extractEmailAddress } from "@/lib/email-parse";
import { normalizeGmailSearchQuery } from "@/lib/gmail-search-query";
import { throwIfGmailInsufficientScope } from "@/lib/gmail-scope-error";
import { fetchGmail, GMAIL_COST } from "@/lib/gmail-quota";
import { describeUpstreamFetchError } from "@/lib/fetch-errors";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailHeader = { name?: string; value?: string };

export type ThreadSearchSuggestion = {
  id: string;
  subject: string;
  from: string;
  /** Comma-separated From/To/Cc — matches Gmail suggest rows (not body snippets). */
  participants: string;
  date: string;
  hasAttachments?: boolean;
};

function parseAddressChunk(chunk: string): string {
  const t = chunk.trim();
  if (!t) return "";
  const m = t.match(/^([^<]+)</);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "");
    if (name) return name;
  }
  return t;
}

function buildParticipants(msgs: { payload?: { headers?: GmailHeader[] } }[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const addHeader = (value: string) => {
    for (const chunk of value.split(",")) {
      const label = parseAddressChunk(chunk);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(label);
    }
  };

  for (const msg of msgs) {
    const headers = msg.payload?.headers ?? [];
    const getH = (key: string) => {
      const h = headers.find((x) => (x.name || "").toLowerCase() === key.toLowerCase());
      return (h?.value || "").trim();
    };
    for (const key of ["From", "To", "Cc"] as const) {
      const v = getH(key);
      if (v) addHeader(v);
    }
  }
  return parts.join(", ");
}

/** Emails in thread headers that match a typeahead query (fills gaps People API misses). */
export function suggestEmailsFromThreads(
  threads: ThreadSearchSuggestion[],
  query: string,
): Array<{ email: string; displayName?: string }> {
  const ql = query.trim().toLowerCase();
  if (!ql) return [];
  const seen = new Set<string>();
  const out: Array<{ email: string; displayName?: string }> = [];

  for (const t of threads) {
    const blob = [t.participants, t.from].filter(Boolean).join(", ");
    for (const chunk of blob.split(",")) {
      const em = extractEmailAddress(chunk).trim().toLowerCase();
      if (!em.includes("@") || !em.includes(ql) || seen.has(em)) continue;
      seen.add(em);
      const label = parseAddressChunk(chunk);
      const displayName =
        label && !label.includes("@") && label.toLowerCase() !== em ? label : undefined;
      out.push({ email: em, displayName });
    }
  }
  return out;
}

export function pickEmailCompletion(
  contacts: Array<{ email: string }>,
  query: string,
): string | undefined {
  const ql = query.trim().toLowerCase();
  if (!ql) return undefined;
  for (const c of contacts) {
    const em = c.email.toLowerCase();
    if (em.startsWith(ql) && em.length > ql.length) return c.email;
  }
  return undefined;
}

async function threadMeta(
  accessToken: string,
  threadId: string,
  mailboxKey: string | undefined,
): Promise<ThreadSearchSuggestion | null> {
  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "Subject");
  params.append("metadataHeaders", "From");
  params.append("metadataHeaders", "Date");
  params.append("metadataHeaders", "Content-Type");

  try {
    const res = await fetchGmail(
      `${GMAIL_API}/threads/${encodeURIComponent(threadId)}?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey, cost: GMAIL_COST.threadsGet },
    );
    if (!res.ok) return null;
    const td = (await res.json()) as {
      messages?: {
        internalDate?: string;
        payload?: { headers?: GmailHeader[] };
      }[];
    };
    const msgs = td.messages ?? [];
    if (!msgs.length) return null;
    const first = msgs[0];
    const last = msgs[msgs.length - 1] ?? first;
    const getH = (msg: typeof first, key: string) => {
      const h = (msg?.payload?.headers ?? []).find(
        (x) => (x.name || "").toLowerCase() === key.toLowerCase(),
      );
      return (h?.value || "").trim();
    };
    const subject = getH(first, "Subject");
    const from = getH(last, "From");
    let date = getH(last, "Date");
    if (last?.internalDate) {
      const ms = parseInt(last.internalDate, 10);
      if (!Number.isNaN(ms)) date = new Date(ms).toISOString();
    }
    const hasAttachments = msgs.some((m) => {
      const ct =
        (m.payload?.headers ?? []).find((h) => (h.name || "").toLowerCase() === "content-type")
          ?.value || "";
      return /^multipart\/mixed/i.test(ct);
    });
    return {
      id: threadId,
      subject,
      from,
      participants: buildParticipants(msgs),
      date,
      hasAttachments,
    };
  } catch {
    return null;
  }
}

/** Lightweight thread hits for the search dropdown (Gmail-style). */
export async function listThreadSearchSuggestions(
  accessToken: string,
  searchQuery: string,
  maxResults = 5,
  opts?: { mailboxKey?: string },
): Promise<ThreadSearchSuggestion[]> {
  const q = normalizeGmailSearchQuery(searchQuery);
  if (!q) return [];

  const params = new URLSearchParams({
    maxResults: String(Math.min(12, maxResults + 4)),
    q,
  });

  let res: Response;
  try {
    res = await fetchGmail(
      `${GMAIL_API}/threads?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.threadsList },
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (search suggest)"));
  }

  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    return [];
  }

  const data = (await res.json()) as {
    threads?: { id: string; snippet?: string }[];
  };

  const raw = (data.threads ?? []).slice(0, maxResults);
  const metas = await Promise.all(
    raw.map(async (t) => {
      return threadMeta(accessToken, t.id, opts?.mailboxKey);
    }),
  );

  return metas.filter((m): m is ThreadSearchSuggestion => Boolean(m));
}

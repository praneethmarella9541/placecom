import "server-only";

import { cleanMailSnippet } from "@/lib/utils";
import { normalizeGmailSearchQuery } from "@/lib/gmail-search-query";
import { throwIfGmailInsufficientScope } from "@/lib/gmail-scope-error";
import { describeUpstreamFetchError } from "@/lib/fetch-errors";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

type GmailHeader = { name?: string; value?: string };

export type ThreadSearchSuggestion = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  hasAttachments?: boolean;
};

async function threadMeta(
  accessToken: string,
  threadId: string,
): Promise<ThreadSearchSuggestion | null> {
  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "Subject");
  params.append("metadataHeaders", "From");
  params.append("metadataHeaders", "Date");
  params.append("metadataHeaders", "Content-Type");

  try {
    const res = await fetch(`${GMAIL_API}/threads/${encodeURIComponent(threadId)}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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
      snippet: "",
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
  maxResults = 6,
): Promise<ThreadSearchSuggestion[]> {
  const q = normalizeGmailSearchQuery(searchQuery);
  if (!q) return [];

  const params = new URLSearchParams({
    maxResults: String(Math.min(12, maxResults + 4)),
    q,
  });

  let res: Response;
  try {
    res = await fetch(`${GMAIL_API}/threads?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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
      const meta = await threadMeta(accessToken, t.id);
      if (!meta) return null;
      return {
        ...meta,
        snippet: cleanMailSnippet(t.snippet || meta.snippet),
      };
    }),
  );

  return metas.filter((m): m is ThreadSearchSuggestion => Boolean(m));
}

import { describeUpstreamFetchError } from "@/lib/fetch-errors";
import { throwIfGmailInsufficientScope } from "@/lib/gmail-scope-error";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailLabelFilter = "inbox" | "sent" | "all";

export function buildListQuery(label: GmailLabelFilter): string {
  switch (label) {
    case "inbox":
      return "in:inbox category:primary";
    case "sent":
      return "in:sent";
    default:
      return "";
  }
}

export type GmailMessageSummary = {
  id: string;
  subject: string;
  from: string;
  body: string;
  date: string;
  internalDate: number;
};

type GmailHeader = { name?: string; value?: string };

function getHeader(headers: GmailHeader[] | undefined, key: string): string {
  if (!headers) return "";
  const lower = key.toLowerCase();
  const h = headers.find((x) => (x.name || "").toLowerCase() === lower);
  return (h?.value || "").trim();
}

function decodeBase64Url(data: string): string {
  const pad = data.length % 4;
  const padded = pad ? data + "=".repeat(4 - pad) : data;
  const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function collectPlainTextParts(payload: Record<string, unknown>): string[] {
  const mimeType = String(payload.mimeType || "");
  const body = payload.body as { data?: string } | undefined;
  const parts = payload.parts as Record<string, unknown>[] | undefined;

  const chunks: string[] = [];

  if (mimeType === "text/plain" && body?.data) {
    chunks.push(decodeBase64Url(body.data));
  }

  if (Array.isArray(parts)) {
    for (const p of parts) {
      chunks.push(...collectPlainTextParts(p as Record<string, unknown>));
    }
  }

  return chunks;
}

export async function fetchGmailMessage(
  accessToken: string,
  messageId: string
): Promise<GmailMessageSummary> {
  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}?format=full`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(
        e,
        "Gmail API (message) — your server must reach https://gmail.googleapis.com"
      )
    );
  }

  if (res.status === 401) {
    const err = new Error("Gmail access token expired or invalid") as Error & {
      code?: string;
    };
    err.code = "UNAUTHORIZED";
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    id: string;
    internalDate?: string;
    payload?: Record<string, unknown>;
  };

  const payload = data.payload || {};
  const headers = (payload.headers as GmailHeader[]) || [];
  const subject = getHeader(headers, "Subject");
  const from = getHeader(headers, "From");
  const dateHeader = getHeader(headers, "Date");

  let date = dateHeader;
  if (data.internalDate) {
    const ms = parseInt(data.internalDate, 10);
    if (!Number.isNaN(ms)) {
      date = new Date(ms).toISOString();
    }
  }

  const body = collectPlainTextParts(payload).join("\n\n").trim();
  const internalMs = data.internalDate ? parseInt(data.internalDate, 10) : 0;

  return {
    id: data.id,
    subject,
    from,
    body,
    date: date || new Date().toISOString(),
    internalDate: Number.isNaN(internalMs) ? 0 : internalMs,
  };
}

export type ListMessagesResult = {
  messageIds: string[];
  nextPageToken?: string;
};

export async function listMessageIdsPage(
  accessToken: string,
  options: {
    maxResults: number;
    pageToken?: string;
    q?: string;
  }
): Promise<ListMessagesResult> {
  const params = new URLSearchParams({
    maxResults: String(Math.min(options.maxResults, 500)),
  });
  if (options.pageToken) params.set("pageToken", options.pageToken);
  if (options.q) params.set("q", options.q);

  const url = `${GMAIL_API}/messages?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(
        e,
        "Gmail API (list) — your server must reach https://gmail.googleapis.com"
      )
    );
  }

  if (res.status === 401) {
    const err = new Error("Gmail access token expired or invalid") as Error & {
      code?: string;
    };
    err.code = "UNAUTHORIZED";
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail list error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    messages?: { id: string }[];
    nextPageToken?: string;
  };

  const messageIds = (data.messages || []).map((m) => m.id);
  return { messageIds, nextPageToken: data.nextPageToken };
}

const FETCH_DELAY_MS = 50;
const ALL_MAIL_CAP = 10_000;

export async function fetchEmailsWithDetails(
  accessToken: string,
  options: {
    maxEmails: number | "all";
    labelFilter: GmailLabelFilter;
    onProgress?: (fetched: number, target: number) => void;
  }
): Promise<GmailMessageSummary[]> {
  const q = buildListQuery(options.labelFilter);
  const target =
    options.maxEmails === "all" ? ALL_MAIL_CAP : Math.min(options.maxEmails, ALL_MAIL_CAP);

  const ids: string[] = [];
  let pageToken: string | undefined;

  while (ids.length < target) {
    const need = Math.min(500, target - ids.length);
    const page = await listMessageIdsPage(accessToken, {
      maxResults: need,
      pageToken,
      q: q || undefined,
    });
    for (const id of page.messageIds) {
      ids.push(id);
      if (ids.length >= target) break;
    }
    if (!page.nextPageToken || page.messageIds.length === 0) break;
    pageToken = page.nextPageToken;
  }

  const results: GmailMessageSummary[] = [];
  const slice = ids.slice(0, target);

  for (let i = 0; i < slice.length; i++) {
    const id = slice[i];
    const msg = await fetchGmailMessage(accessToken, id);
    results.push(msg);
    options.onProgress?.(i + 1, slice.length);
    if (i < slice.length - 1) {
      await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    }
  }

  return results;
}

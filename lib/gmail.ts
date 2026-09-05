import { describeUpstreamFetchError } from "@/lib/fetch-errors";
import { throwIfGmailInsufficientScope } from "@/lib/gmail-scope-error";
import {
  fetchGmail,
  GMAIL_COST,
  GmailRateLimitError,
  isRateLimitedResponse,
} from "@/lib/gmail-quota";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Quota accounting, backoff and the rate-limit error type all live in
 * lib/gmail-quota.ts now, so this module and lib/gmail-inbox.ts draw on ONE
 * per-mailbox budget instead of each retrying against a limit it could not see
 * the other spending. Re-exported because callers (lib/people-mailbox-sync.ts)
 * import GmailRateLimitError from here.
 */
export { GmailRateLimitError } from "@/lib/gmail-quota";

type GmailCallOpts = { mailboxKey?: string };

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
  /** `data:image/…;base64,…` URLs for vision-capable models (inline + attachment image parts). */
  images?: string[];
};

type GmailHeader = { name?: string; value?: string };

function getHeader(headers: GmailHeader[] | undefined, key: string): string {
  if (!headers) return "";
  const lower = key.toLowerCase();
  const h = headers.find((x) => (x.name || "").toLowerCase() === lower);
  return (h?.value || "").trim();
}

function padBase64Url(data: string): string {
  const pad = data.length % 4;
  return pad ? data + "=".repeat(4 - pad) : data;
}

function decodeBase64Url(data: string): string {
  const b64 = padBase64Url(data).replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function decodeBase64UrlToBuffer(data: string): Buffer | null {
  const b64 = padBase64Url(data).replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

const VISION_IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function normalizeVisionImageMime(mime: string): string | null {
  let base = mime.toLowerCase().split(";")[0]?.trim() || "";
  if (base === "image/jpg") base = "image/jpeg";
  if (VISION_IMAGE_MIMES.has(base)) return base;
  return null;
}

function extractionImageLimits(): { maxPerEmail: number; maxBytes: number } {
  if (
    process.env.EXTRACTION_INCLUDE_IMAGE_PARTS === "0" ||
    process.env.EXTRACTION_INCLUDE_IMAGE_PARTS === "false"
  ) {
    return { maxPerEmail: 0, maxBytes: 0 };
  }
  const maxPer = parseInt(process.env.EXTRACTION_MAX_IMAGES_PER_EMAIL || "4", 10);
  const maxBytes = parseInt(process.env.EXTRACTION_MAX_IMAGE_BYTES || "400000", 10);
  return {
    maxPerEmail: Number.isFinite(maxPer) ? Math.min(12, Math.max(0, maxPer)) : 4,
    maxBytes: Number.isFinite(maxBytes) ? Math.min(2_000_000, Math.max(10_000, maxBytes)) : 400_000,
  };
}

export async function fetchGmailAttachmentBytes(
  accessToken: string,
  messageId: string,
  attachmentId: string,
  opts?: GmailCallOpts
): Promise<Buffer | null> {
  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  let res: Response;
  try {
    res = await fetchGmail(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.attachmentsGet }
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: string };
  if (!data.data) return null;
  return decodeBase64UrlToBuffer(data.data);
}

async function collectImageDataUrlsFromPayload(
  accessToken: string,
  messageId: string,
  payload: Record<string, unknown>
): Promise<string[]> {
  const { maxPerEmail, maxBytes } = extractionImageLimits();
  if (maxPerEmail <= 0) return [];

  const out: string[] = [];
  let count = 0;

  async function walk(part: Record<string, unknown>): Promise<void> {
    if (count >= maxPerEmail) return;

    const mimeRaw = String(part.mimeType || "");
    const mimeNorm = normalizeVisionImageMime(mimeRaw);
    const body = part.body as { data?: string; attachmentId?: string; size?: number } | undefined;
    const parts = part.parts as Record<string, unknown>[] | undefined;

    if (mimeNorm && body) {
      let buf: Buffer | null = null;
      if (body.data) {
        buf = decodeBase64UrlToBuffer(body.data);
      } else if (body.attachmentId) {
        const declared = typeof body.size === "number" ? body.size : undefined;
        if (declared !== undefined && declared > maxBytes) {
          /* skip huge declared attachments */
        } else {
          buf = await fetchGmailAttachmentBytes(accessToken, messageId, body.attachmentId);
        }
      }
      if (buf && buf.length > 0 && buf.length <= maxBytes) {
        out.push(`data:${mimeNorm};base64,${buf.toString("base64")}`);
        count++;
      }
    }

    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (count >= maxPerEmail) return;
        await walk(p as Record<string, unknown>);
      }
    }
  }

  await walk(payload);
  return out;
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
  messageId: string,
  opts?: GmailCallOpts
): Promise<GmailMessageSummary> {
  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}?format=full`;
  let res: Response;
  try {
    res = await fetchGmail(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.messagesGet }
    );
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

  const images = await collectImageDataUrlsFromPayload(accessToken, data.id, payload);

  return {
    id: data.id,
    subject,
    from,
    body,
    date: date || new Date().toISOString(),
    internalDate: Number.isNaN(internalMs) ? 0 : internalMs,
    ...(images.length > 0 ? { images } : {}),
  };
}

export type GmailMessageHeaders = {
  id: string;
  threadId?: string;
  from: string;
  to: string;
  cc: string;
  internalDate: number;
};

/**
 * Header-only fetch (format=metadata) — skips Google's body/attachment walk entirely,
 * so it's materially cheaper than fetchGmailMessage() when bulk-scanning for
 * sender/recipient addresses (e.g. people/company auto-population) rather than content.
 */
export async function fetchGmailMessageHeaders(
  accessToken: string,
  messageId: string,
  opts?: GmailCallOpts
): Promise<GmailMessageHeaders> {
  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "From");
  params.append("metadataHeaders", "To");
  params.append("metadataHeaders", "Cc");
  params.append("metadataHeaders", "Date");
  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}?${params.toString()}`;

  let res: Response;
  try {
    res = await fetchGmail(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.messagesGet }
    );
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(
        e,
        "Gmail API (message headers) — your server must reach https://gmail.googleapis.com"
      )
    );
  }

  if (res.status === 401) {
    const err = new Error("Gmail access token expired or invalid") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    if (isRateLimitedResponse(res.status, text)) {
      throw new GmailRateLimitError(`Gmail message-headers quota exhausted: ${text}`);
    }
    const err = new Error(`Gmail API error ${res.status}: ${text}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  const data = (await res.json()) as {
    id: string;
    threadId?: string;
    internalDate?: string;
    payload?: { headers?: GmailHeader[] };
  };

  const headers = data.payload?.headers;
  const internalMs = data.internalDate ? parseInt(data.internalDate, 10) : 0;

  return {
    id: data.id,
    threadId: data.threadId,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc"),
    internalDate: Number.isNaN(internalMs) ? 0 : internalMs,
  };
}

export async function fetchGmailMessageHeadersByIds(
  accessToken: string,
  ids: string[],
  opts?: {
    onProgress?: (fetched: number, target: number) => void;
    concurrency?: number;
    mailboxKey?: string;
  }
): Promise<GmailMessageHeaders[]> {
  if (ids.length === 0) return [];
  const concurrency = opts?.concurrency ?? gmailFetchConcurrency();
  const total = ids.length;
  let done = 0;
  const results = await mapWithConcurrency(
    ids,
    concurrency,
    async (id) => {
      try {
        return await fetchGmailMessageHeaders(accessToken, id, {
          mailboxKey: opts?.mailboxKey,
        });
      } catch (e) {
        // Quota exhaustion is NOT a per-message defect — every remaining id in
        // this page would fail the same way, and skipping them would drop those
        // messages from the scan permanently and silently (the caller advances
        // its cursor past the page regardless). Propagate so the batch can stop
        // and be retried against a fresh quota window.
        if (e instanceof GmailRateLimitError) throw e;

        // Skipping is only ever safe for a message Gmail will NEVER return —
        // callers advance their cursor past this page either way, so anything
        // skipped here is dropped from the scan permanently and silently. A 4xx
        // is a property of the message (Google Chat threads under the "Chats"
        // label 400 with "Precondition check failed" on format=metadata); a 5xx
        // or a network fault is transient and would succeed on a retry, so it
        // must propagate and let the page be re-fetched instead.
        const status = (e as { status?: number } | null)?.status;
        const permanent = typeof status === "number" && status >= 400 && status < 500;
        if (!permanent) throw e;

        console.warn(`fetchGmailMessageHeaders(${id}) unreadable (${status}), skipping:`, e);
        return null;
      }
    },
    () => {
      done += 1;
      opts?.onProgress?.(done, total);
    }
  );
  return results.filter((r): r is GmailMessageHeaders => r !== null);
}

export type ListMessagesResult = {
  messageIds: string[];
  nextPageToken?: string;
  /**
   * Gmail's own estimate of how many messages match the query. Approximate —
   * treat it as a denominator for a progress indicator, never as an exact count.
   */
  resultSizeEstimate?: number;
};

export async function listMessageIdsPage(
  accessToken: string,
  options: {
    maxResults: number;
    pageToken?: string;
    q?: string;
    mailboxKey?: string;
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
    res = await fetchGmail(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: options.mailboxKey, cost: GMAIL_COST.messagesList }
    );
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
    if (isRateLimitedResponse(res.status, text)) {
      throw new GmailRateLimitError(`Gmail list quota exhausted: ${text}`);
    }
    throw new Error(`Gmail list error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    messages?: { id: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };

  const messageIds = (data.messages || []).map((m) => m.id);
  return {
    messageIds,
    nextPageToken: data.nextPageToken,
    resultSizeEstimate: data.resultSizeEstimate,
  };
}

/** Current mailbox historyId — the incremental contact sync's starting cursor (lib/people-mailbox-sync.ts). */
export async function fetchGmailHistoryId(
  accessToken: string,
  opts?: GmailCallOpts
): Promise<string | null> {
  const res = await fetchGmail(
    `${GMAIL_API}/profile`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.getProfile }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { historyId?: string };
  return data.historyId?.trim() || null;
}

export type GmailHistoryPage = {
  messagesAdded: { id: string; threadId: string; labelIds: string[] }[];
  nextPageToken?: string;
  /** Latest historyId Gmail reports for this page — advance the stored cursor to this. */
  historyId?: string;
};

/** Thrown when Gmail reports the historyId has expired (>30 days idle) — caller falls back to a date-based catch-up. */
export class GmailHistoryExpiredError extends Error {
  constructor() {
    super("Gmail historyId expired");
  }
}

/**
 * Pages Gmail's history.list — an exact changelog of mailbox events since
 * startHistoryId, cheaper and precise unlike an `after:<date>` search rescan
 * (which can double-count or miss messages at the boundary). Only messageAdded
 * events are surfaced; callers that don't need deletions (e.g. the contact
 * sync, which never removes a contact just because a message was deleted)
 * can ignore that Gmail also reports messageDeleted in the same feed.
 */
export async function fetchGmailHistoryPage(
  accessToken: string,
  startHistoryId: string,
  pageToken?: string,
  opts?: GmailCallOpts
): Promise<GmailHistoryPage> {
  const params = new URLSearchParams({ startHistoryId, maxResults: "500" });
  params.append("historyTypes", "messageAdded");
  if (pageToken) params.set("pageToken", pageToken);

  const res = await fetchGmail(
    `${GMAIL_API}/history?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.historyList }
  );

  if (res.status === 404) throw new GmailHistoryExpiredError();
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail history error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
    historyId?: string;
    nextPageToken?: string;
  };

  const messagesAdded: GmailHistoryPage["messagesAdded"] = [];
  for (const entry of data.history || []) {
    for (const a of entry.messagesAdded || []) {
      messagesAdded.push({ id: a.message.id, threadId: a.message.threadId, labelIds: a.message.labelIds || [] });
    }
  }

  return { messagesAdded, nextPageToken: data.nextPageToken, historyId: data.historyId };
}

const ALL_MAIL_CAP = 10_000;

// 15,000 units/min ÷ 5 units per messages.get = 3,000 requests/min = 50/sec, the
// hard per-user ceiling. At ~250ms per request a concurrency of 12 lands just under
// that; the previous default of 20 sustained ~80/sec, i.e. roughly 1.6x over quota,
// which is why bulk scans leaned on backoff to throttle themselves and eventually
// tripped `defaultPerMinutePerUser`. Raising this does not buy throughput — the
// quota, not the client, is the limit.
function gmailFetchConcurrency(): number {
  const n = parseInt(process.env.GMAIL_FETCH_CONCURRENCY || "12", 10);
  if (!Number.isFinite(n) || n < 1) return 12;
  return Math.min(32, Math.floor(n));
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapFn: (item: T, index: number) => Promise<R>,
  onItemComplete?: () => void
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await mapFn(items[i], i);
      onItemComplete?.();
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

export type CollectIdsResult = {
  messageIds: string[];
  skippedCount: number;
};

/**
 * List message ids up to the cap (paged Gmail list API).
 * When excludeIds is set, pages through Gmail until target new ids are found or inbox ends.
 */
export async function collectMessageIdsForFetch(
  accessToken: string,
  options: {
    maxEmails: number | "all";
    labelFilter: GmailLabelFilter;
    excludeIds?: Set<string>;
    onListProgress?: (progress: { listed: number; skipped: number }) => void;
    mailboxKey?: string;
  }
): Promise<CollectIdsResult> {
  const q = buildListQuery(options.labelFilter);
  const exclude = options.excludeIds;
  const skipExisting = Boolean(exclude && exclude.size > 0);
  const target =
    options.maxEmails === "all" ? ALL_MAIL_CAP : Math.min(options.maxEmails, ALL_MAIL_CAP);

  const ids: string[] = [];
  let skippedCount = 0;
  let pageToken: string | undefined;
  const maxScan =
    skipExisting && options.maxEmails !== "all"
      ? Math.min(ALL_MAIL_CAP, target * 100)
      : ALL_MAIL_CAP;
  let scanned = 0;

  while (ids.length < target) {
    const remaining = target - ids.length;
    const pageSize = skipExisting
      ? Math.min(500, Math.max(remaining, 50))
      : Math.min(500, remaining);
    const page = await listMessageIdsPage(accessToken, {
      maxResults: pageSize,
      pageToken,
      q: q || undefined,
      mailboxKey: options.mailboxKey,
    });
    if (page.messageIds.length === 0) break;

    for (const id of page.messageIds) {
      if (skipExisting) {
        scanned += 1;
        if (exclude!.has(id)) {
          skippedCount += 1;
          continue;
        }
      }
      ids.push(id);
      if (ids.length >= target) break;
    }

    options.onListProgress?.({ listed: ids.length, skipped: skippedCount });

    if (!page.nextPageToken) break;
    if (skipExisting && scanned >= maxScan) break;
    pageToken = page.nextPageToken;
  }

  return { messageIds: ids.slice(0, target), skippedCount };
}

/**
 * Download full messages in parallel (bounded concurrency). Preserves id order.
 */
export async function fetchGmailMessagesByIds(
  accessToken: string,
  ids: string[],
  opts?: {
    onProgress?: (fetched: number, target: number) => void;
    concurrency?: number;
    mailboxKey?: string;
  }
): Promise<GmailMessageSummary[]> {
  if (ids.length === 0) return [];
  const concurrency = opts?.concurrency ?? gmailFetchConcurrency();
  const total = ids.length;
  let done = 0;
  return mapWithConcurrency(
    ids,
    concurrency,
    (id) => fetchGmailMessage(accessToken, id, { mailboxKey: opts?.mailboxKey }),
    () => {
      done += 1;
      opts?.onProgress?.(done, total);
    }
  );
}

export async function fetchEmailsWithDetails(
  accessToken: string,
  options: {
    maxEmails: number | "all";
    labelFilter: GmailLabelFilter;
    onProgress?: (fetched: number, target: number) => void;
    mailboxKey?: string;
  }
): Promise<GmailMessageSummary[]> {
  const { messageIds } = await collectMessageIdsForFetch(accessToken, {
    maxEmails: options.maxEmails,
    labelFilter: options.labelFilter,
    mailboxKey: options.mailboxKey,
  });
  return fetchGmailMessagesByIds(accessToken, messageIds, {
    onProgress: options.onProgress,
    mailboxKey: options.mailboxKey,
  });
}

export async function sendGmailMessage(
  accessToken: string,
  to: string,
  subject: string,
  bodyText: string
): Promise<void> {
  const emailLines = [
    `To: ${to}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: =?utf-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "",
    bodyText,
  ];
  
  const rawEmail = Buffer.from(emailLines.join("\r\n")).toString("base64url");
  
  const url = `${GMAIL_API}/messages/send`;
  const res = await fetchGmail(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: rawEmail }),
    },
    { cost: GMAIL_COST.messagesSend }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail send error ${res.status}: ${text}`);
  }
}

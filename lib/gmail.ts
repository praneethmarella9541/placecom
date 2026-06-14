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
  attachmentId: string
): Promise<Buffer | null> {
  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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

const ALL_MAIL_CAP = 10_000;

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
  }
): Promise<GmailMessageSummary[]> {
  if (ids.length === 0) return [];
  const concurrency = opts?.concurrency ?? gmailFetchConcurrency();
  const total = ids.length;
  let done = 0;
  return mapWithConcurrency(
    ids,
    concurrency,
    (id) => fetchGmailMessage(accessToken, id),
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
  }
): Promise<GmailMessageSummary[]> {
  const { messageIds } = await collectMessageIdsForFetch(accessToken, {
    maxEmails: options.maxEmails,
    labelFilter: options.labelFilter,
  });
  return fetchGmailMessagesByIds(accessToken, messageIds, {
    onProgress: options.onProgress,
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
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: rawEmail }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail send error ${res.status}: ${text}`);
  }
}

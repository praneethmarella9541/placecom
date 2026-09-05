import { isCalendarInviteThread } from "@/lib/calendar-invite-email";
import { describeUpstreamFetchError } from "@/lib/fetch-errors";
import { cleanMailSnippet } from "@/lib/utils";
import {
  extractSingleFromEmail,
  normalizeGmailSearchQuery,
} from "@/lib/gmail-search-query";
import { draftSubjectForDisplay } from "@/lib/gmail-draft-subject";
import { throwIfGmailInsufficientScope } from "@/lib/gmail-scope-error";
import { fetchGmail, GMAIL_COST, type GmailPriority } from "@/lib/gmail-quota";
import {
  getCachedThreadMeta,
  setCachedThreadMeta,
  type ThreadMeta,
} from "@/lib/gmail-thread-meta-cache";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type MailFolder = "inbox" | "sent" | "drafts" | "trash" | "spam" | "allmail";

export type ThreadListItem = {
  /** Thread id — used to open `/api/gmail/threads/:id` (same as Gmail conversation). */
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  historyId?: string;
  /** Present for drafts list rows — stable key when multiple drafts share a thread. */
  draftId?: string;
  /** True if any message in the thread carries the Gmail UNREAD label. */
  unread?: boolean;
  /** True if any message in the thread is starred. Rendered as a star icon
   *  in the row rather than a chip. */
  starred?: boolean;
  /** Heuristic: at least one message's Content-Type is multipart/mixed
   *  (i.e. it has an attachment). Cheap because we already fetch the
   *  Content-Type header in the metadata call. */
  hasAttachments?: boolean;
  /** Calendar invitation thread (shows calendar icon instead of paperclip in list). */
  hasCalendarInvite?: boolean;
  /** Any message carries IMPORTANT — rendered as its own icon, like STARRED. */
  important?: boolean;
  /** Unique label ids across all messages in the thread. The UI maps these
   *  through the labels list to render chips. Excludes folder-state labels
   *  (INBOX/SENT/DRAFT/etc.) AND STARRED (which has its own icon). */
  labelIds?: string[];
};

export type ThreadListPage = {
  threads: ThreadListItem[];
  nextPageToken?: string;
};

type ThreadListFolder = Exclude<MailFolder, "drafts">;

const LABELS: Record<ThreadListFolder, string[]> = {
  inbox: ["INBOX"],
  sent: ["SENT"],
  trash: ["TRASH"],
  spam: ["SPAM"],
  allmail: [],
};

const QUERY: Record<ThreadListFolder, string> = {
  inbox: "",
  sent: "",
  trash: "",
  spam: "",
  allmail: "",
};

async function fetchMessageMeta(
  accessToken: string,
  messageId: string,
  opts?: { includeTo?: boolean; mailboxKey?: string }
): Promise<{
  subject: string;
  from: string;
  date: string;
  to?: string;
  labelIds?: string[];
  hasAttachments?: boolean;
}> {
  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "Subject");
  params.append("metadataHeaders", "From");
  params.append("metadataHeaders", "Date");
  params.append("metadataHeaders", "Content-Type");
  if (opts?.includeTo) params.append("metadataHeaders", "To");
  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}?${params.toString()}`;
  try {
    const res = await fetchGmail(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.messagesGet }
    );
    if (!res.ok) return { subject: "", from: "", date: "", to: "", labelIds: [] };
    const data = (await res.json()) as {
      internalDate?: string;
      labelIds?: string[];
      payload?: { headers?: { name?: string; value?: string }[] };
    };
    const headers = data.payload?.headers || [];
    const get = (k: string) => {
      const lower = k.toLowerCase();
      const h = headers.find((x) => (x.name || "").toLowerCase() === lower);
      return (h?.value || "").trim();
    };
    let date = get("Date");
    if (data.internalDate) {
      const ms = parseInt(data.internalDate, 10);
      if (!Number.isNaN(ms)) date = new Date(ms).toISOString();
    }
    const to = opts?.includeTo ? get("To") : undefined;
    const contentType = get("Content-Type");
    const hasAttachments = /^multipart\/mixed/i.test(contentType);
    return {
      subject: get("Subject"),
      from: get("From"),
      date,
      labelIds: data.labelIds ?? [],
      hasAttachments,
      ...(to !== undefined ? { to } : {}),
    };
  } catch {
    return { subject: "", from: "", date: "", to: "", labelIds: [] };
  }
}

/** Gmail drafts — synced via `users.drafts.list` (requires gmail.readonly). */
export async function listDraftsPage(
  accessToken: string,
  options: {
    maxResults: number;
    pageToken?: string;
    searchQuery?: string;
    /** Mailbox this page is billed to — scopes the shared quota bucket. */
    mailboxKey?: string;
  }
): Promise<ThreadListPage> {
  const params = new URLSearchParams({
    maxResults: String(Math.min(Math.max(options.maxResults, 1), 100)),
  });
  if (options.pageToken) params.set("pageToken", options.pageToken);
  const q = normalizeGmailSearchQuery(options.searchQuery || "");
  if (q) params.set("q", q);

  const url = `${GMAIL_API}/drafts?${params.toString()}`;
  let res: Response;
  try {
    res = await fetchGmail(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: options.mailboxKey, cost: GMAIL_COST.draftsList }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (drafts list)"));
  }

  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail drafts list ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    drafts?: {
      id: string;
      message?: { id?: string; threadId?: string; snippet?: string };
    }[];
    nextPageToken?: string;
  };

  const raw = data.drafts || [];
  const threads: ThreadListItem[] = await Promise.all(
    raw.map(async (d) => {
      const messageId = d.message?.id || "";
      const snippet = d.message?.snippet || "";
      if (!messageId) {
        return {
          id: d.id, // use draftId as the unique row id to avoid threadId collisions
          snippet,
          subject: draftSubjectForDisplay(""),
          from: "",
          date: "",
          draftId: d.id,
        };
      }
      const meta = await fetchMessageMeta(accessToken, messageId, {
        includeTo: true,
        mailboxKey: options.mailboxKey,
      });
      const toLine = (meta.to || "").trim();
      const displayLine = toLine || meta.from.trim() || "Draft";
      return {
        id: d.id, // use draftId as the unique row id to avoid threadId collisions
        snippet: cleanMailSnippet(snippet || meta.subject || ""),
        subject: draftSubjectForDisplay(meta.subject),
        from: displayLine,
        date: meta.date,
        draftId: d.id,
        hasAttachments: meta.hasAttachments,
      };
    })
  );

  return { threads, nextPageToken: data.nextPageToken };
}

/**
 * Map CATEGORY_* label ids → Gmail search query terms.
 * Gmail threads in "Primary" don't always carry the CATEGORY_PERSONAL label
 * themselves — so filtering by labelIds=CATEGORY_PERSONAL excludes them.
 * Using `category:primary` in the `q` param correctly matches Gmail's own tab.
 */
const CATEGORY_LABEL_TO_QUERY: Record<string, string> = {
  CATEGORY_PERSONAL:   "category:primary",
  CATEGORY_PROMOTIONS: "category:promotions",
  CATEGORY_SOCIAL:     "category:social",
  CATEGORY_UPDATES:    "category:updates",
  CATEGORY_FORUMS:     "category:forums",
};

const FOLDER_LABELS_FOR_CHIPS = new Set([
  "INBOX",
  "SENT",
  "DRAFT",
  "TRASH",
  "SPAM",
  "UNREAD",
  "CHAT",
  // STARRED and IMPORTANT get their own icons in the row, so they are state,
  // not chips — same as Gmail.
  "STARRED",
  "IMPORTANT",
]);

type RawThreadMessages = {
  messages?: {
    id: string;
    internalDate?: string;
    labelIds?: string[];
    payload?: { headers?: GmailHeader[] };
  }[];
};

/** Turn a threads.get(format=metadata) body into the cacheable half of a list row. */
function deriveThreadMeta(td: RawThreadMessages): ThreadMeta {
  const msgs = td.messages || [];
  // Subject comes from the first message; From/Date from the last.
  const first = msgs[0];
  const last = msgs[msgs.length - 1] ?? first;
  const getH = (msg: typeof first, key: string) => {
    const h = (msg?.payload?.headers || []).find(
      (x) => (x.name || "").toLowerCase() === key.toLowerCase()
    );
    return (h?.value || "").trim();
  };
  let date = getH(last, "Date");
  if (last?.internalDate) {
    const ms = parseInt(last.internalDate, 10);
    if (!Number.isNaN(ms)) date = new Date(ms).toISOString();
  }
  const allLabelIds = Array.from(new Set(msgs.flatMap((m) => m.labelIds ?? [])));
  // hasAttachments — any message whose top-level Content-Type starts with
  // multipart/mixed (Gmail's signal for "has attachments").
  const hasAttachments = msgs.some((m) => {
    const ct =
      (m.payload?.headers || []).find((h) => (h.name || "").toLowerCase() === "content-type")
        ?.value || "";
    return /^multipart\/mixed/i.test(ct);
  });
  return {
    subject: getH(first, "Subject"),
    from: getH(last, "From"),
    date,
    // Strip folder-state labels — the row's folder tab already conveys this.
    labelIds: allLabelIds.filter((id) => !FOLDER_LABELS_FOR_CHIPS.has(id)),
    unread: allLabelIds.includes("UNREAD"),
    starred: allLabelIds.includes("STARRED"),
    important: allLabelIds.includes("IMPORTANT"),
    hasAttachments,
  };
}

/**
 * Coalesces concurrent `threads.get` calls for the same thread+historyId.
 *
 * The warmed list views overlap heavily (a Primary thread is also in INBOX,
 * IMPORTANT and All Mail) and they warm in parallel, so without this the cache
 * would only help *sequential* requests — every concurrent view would still pay
 * its own 10 units for the identical thread.
 */
const metaInflight = new Map<string, Promise<ThreadMeta | null>>();

async function fetchThreadMeta(
  accessToken: string,
  threadId: string,
  historyId: string | undefined,
  mailboxKey: string | undefined,
  priority: GmailPriority | undefined
): Promise<ThreadMeta | null> {
  const cached = getCachedThreadMeta(mailboxKey, threadId, historyId);
  if (cached) return cached;

  const key = `${mailboxKey ?? "-"}:${threadId}:${historyId ?? "-"}`;
  if (historyId) {
    const existing = metaInflight.get(key);
    if (existing) return existing;
  }

  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "Subject");
  params.append("metadataHeaders", "From");
  params.append("metadataHeaders", "Date");
  // Used to derive hasAttachments cheaply (multipart/mixed → has files).
  params.append("metadataHeaders", "Content-Type");

  const promise = (async () => {
    try {
      const res = await fetchGmail(
        `${GMAIL_API}/threads/${encodeURIComponent(threadId)}?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        { mailboxKey, cost: GMAIL_COST.threadsGet, priority }
      );
      if (!res.ok) return null;
      const meta = deriveThreadMeta((await res.json()) as RawThreadMessages);
      setCachedThreadMeta(mailboxKey, threadId, historyId, meta);
      return meta;
    } catch {
      return null;
    }
  })();

  if (historyId) {
    metaInflight.set(key, promise);
    void promise.finally(() => metaInflight.delete(key));
  }
  return promise;
}

/**
 * Fill in each listed thread's header row.
 *
 * Was an unbounded `Promise.all` of raw `threads.get` calls — a 100-row page
 * fired 100 at once (1,000 quota units in a single burst), which is what tripped
 * the per-minute ceiling. Every call is now cache-checked, deduped against
 * concurrent twins, and metered by the shared quota bucket, so the bucket paces
 * the fan-out rather than a fixed constant that knew nothing about what the rest
 * of the app was spending at the same moment.
 */
async function mapThreadsWithMeta(
  accessToken: string,
  rawThreads: { id: string; snippet?: string; historyId?: string }[],
  mailboxKey: string | undefined,
  priority: GmailPriority | undefined
): Promise<ThreadListItem[]> {
  return Promise.all(
    rawThreads.map(async (t): Promise<ThreadListItem> => {
      const snippet = cleanMailSnippet(t.snippet || "");
      const meta = await fetchThreadMeta(accessToken, t.id, t.historyId, mailboxKey, priority);
      if (!meta) {
        return { id: t.id, snippet, subject: "", from: "", date: "", historyId: t.historyId };
      }
      return {
        id: t.id,
        snippet,
        historyId: t.historyId,
        ...meta,
        hasCalendarInvite: isCalendarInviteThread({
          subject: meta.subject,
          from: meta.from,
          snippet,
        }),
      };
    })
  );
}

export async function listThreadsPage(
  accessToken: string,
  options: {
    folder: ThreadListFolder;
    maxResults: number;
    pageToken?: string;
    /** Gmail search terms (same syntax as Gmail search box), AND-ed with folder filters. */
    searchQuery?: string;
    /** Optional additional label id to filter by (intersected with folder labels).
     *  CATEGORY_* labels are translated to `category:xxx` query terms so threads
     *  that Gmail hasn't explicitly tagged still appear (matches Gmail's own tabs). */
    labelId?: string;
    /** Mailbox this page is billed to — scopes the quota bucket and the thread
     *  metadata cache. Omit only where no mailbox identity is available; the
     *  call then runs unmetered and uncached. */
    mailboxKey?: string;
    /** "batch" lets background scans yield the reserve to interactive traffic. */
    priority?: GmailPriority;
  }
): Promise<ThreadListPage> {
  const rawUserQ = normalizeGmailSearchQuery(options.searchQuery || "");
  const userQ = rawUserQ;
  const isSearch = userQ.length > 0;

  // When a search query is active, drop ALL folder/label restrictions so
  // results come from all mail (inbox + sent + etc.) — exactly like Gmail's
  // own search bar. Only apply folder + category filters when browsing.
  const labels: string[] = isSearch ? [] : [...LABELS[options.folder]];
  const categoryQuery = (!isSearch && options.labelId) ? CATEGORY_LABEL_TO_QUERY[options.labelId] : undefined;
  if (!isSearch && options.labelId && !categoryQuery && !labels.includes(options.labelId)) {
    labels.push(options.labelId);
  }
  const baseQ = isSearch ? "" : QUERY[options.folder];
  const q = [baseQ, categoryQuery, userQ].filter(Boolean).join(" ");

  // For pure `from:X` queries, also run a supplemental full-text search for
  // the person's email address. This catches Google notification emails
  // (e.g. "shared a file with you", Drive activity) that are sent FROM
  // Google's system addresses but mention the person's email in the body/
  // subject — Gmail's own search surfaces these, we mirror that behaviour.
  const fromEmail = isSearch ? extractSingleFromEmail(rawUserQ) : null;

  const requestedMax = Math.min(Math.max(options.maxResults, 1), 100);
  const fetchSize = requestedMax;
  const params = new URLSearchParams({ maxResults: String(fetchSize) });
  for (const l of labels) params.append("labelIds", l);
  if (q) params.set("q", q);
  if (options.pageToken) params.set("pageToken", options.pageToken);

  const url = `${GMAIL_API}/threads?${params.toString()}`;

  let res: Response;
  let supplementalIds: string[] = [];
  try {
    if (fromEmail && !options.pageToken) {
      const mentionUrl = `${GMAIL_API}/threads?${new URLSearchParams({
        maxResults: String(requestedMax),
        q: `"${fromEmail}"`,
      }).toString()}`;
      const listInit = { headers: { Authorization: `Bearer ${accessToken}` } };
      const listOpts = {
        mailboxKey: options.mailboxKey,
        cost: GMAIL_COST.threadsList,
        priority: options.priority,
      };
      const [primaryRes, mentionRes] = await Promise.all([
        fetchGmail(url, listInit, listOpts),
        fetchGmail(mentionUrl, listInit, listOpts),
      ]);
      res = primaryRes;
      if (mentionRes.ok) {
        const mentionData = (await mentionRes.json()) as { threads?: { id: string }[] };
        supplementalIds = (mentionData.threads ?? []).map((t) => t.id).filter(Boolean);
      }
    } else {
      res = await fetchGmail(
        url,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        { mailboxKey: options.mailboxKey, cost: GMAIL_COST.threadsList, priority: options.priority }
      );
    }
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (threads list)"));
  }

  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }

  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail threads list ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    threads?: { id: string; snippet?: string; historyId?: string }[];
    nextPageToken?: string;
  };

  let rawThreads = data.threads || [];
  const nextPageTokenFromApi = data.nextPageToken;

  if (isSearch && supplementalIds.length > 0) {
    const seen = new Set(rawThreads.map((t) => t.id));
    const merged = [...rawThreads];
    for (const tid of supplementalIds) {
      if (!seen.has(tid)) {
        seen.add(tid);
        merged.push({ id: tid });
      }
    }
    rawThreads = merged.slice(0, requestedMax);
  }

  const threads: ThreadListItem[] = await mapThreadsWithMeta(
    accessToken,
    rawThreads,
    options.mailboxKey,
    options.priority
  );

  // Gmail's own order (from data.threads above) ranks a thread by when it last
  // touched the requested label — for the Inbox tab, that's "last INBOX
  // arrival". The date shown on each row, though, is the last message in the
  // *whole* thread regardless of label (fetched above, unfiltered) — so a
  // thread you replied to (landing in Sent, not Inbox) can display a newer
  // date than a thread ranked above it, and the list visibly isn't sorted by
  // what it shows. Re-sorting by that same displayed date makes the list
  // internally consistent; it can't fix Gmail's own ranking upstream (real
  // Gmail has the identical quirk), only stop this view from contradicting
  // itself. Threads whose date lookup failed (empty string) sort last rather
  // than to the top, which an empty-string compare would otherwise do.
  const dateMs = (d: string) => {
    // Usually ISO (internalDate was present, above) but falls back to the raw
    // RFC 2822 `Date` header when it wasn't — Date.parse handles both, a plain
    // string compare wouldn't for the latter.
    const ms = Date.parse(d);
    return Number.isNaN(ms) ? 0 : ms;
  };
  threads.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return dateMs(b.date) - dateMs(a.date);
  });

  return { threads, nextPageToken: nextPageTokenFromApi };
}

/**
 * Remove the UNREAD label from every message in a thread.
 * Requires the gmail.modify scope.
 */
export async function markThreadRead(
  accessToken: string,
  threadId: string,
  opts?: { mailboxKey?: string }
): Promise<void> {
  const url = `${GMAIL_API}/threads/${encodeURIComponent(threadId)}/modify`;
  let res: Response;
  try {
    res = await fetchGmail(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.threadsModify }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (mark thread read)"));
  }
  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail mark-read ${res.status}: ${text}`);
  }
}

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

function collectParts(
  payload: Record<string, unknown>,
  targetMime: string
): string[] {
  const mimeType = String(payload.mimeType || "");
  const body = payload.body as { data?: string } | undefined;
  const parts = payload.parts as Record<string, unknown>[] | undefined;
  const chunks: string[] = [];
  if (mimeType === targetMime && body?.data) {
    chunks.push(decodeBase64Url(body.data));
  }
  if (Array.isArray(parts)) {
    for (const p of parts) {
      chunks.push(...collectParts(p as Record<string, unknown>, targetMime));
    }
  }
  return chunks;
}

export type AttachmentInfo = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  /** Content-ID for inline MIME parts (`cid:` in HTML). */
  contentId?: string;
  /** Inline image bytes from Gmail `body.data` when no attachmentId. */
  inlineDataUri?: string;
};

export type ThreadMessageView = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  date: string;
  body: string;
  bodyHtml: string;
  messageIdHeader?: string;
  attachments: AttachmentInfo[];
  /** Only present when it differs from From — Gmail's own "Show details" omits a redundant reply-to too. */
  replyTo?: string;
  /** Return-Path domain — Gmail's "mailed-by" (e.g. a relay like amazonses.com sending on the real sender's behalf). */
  mailedBy?: string;
  /** DKIM-Signature `d=` domain — Gmail's "signed-by". */
  signedBy?: string;
};

/** Return-Path is `<bounce+xyz@domain.com>` — Gmail's "mailed-by" is just the domain. */
function domainFromReturnPath(value: string): string | undefined {
  const m = value.match(/@([^>\s]+)>?\s*$/);
  return m?.[1]?.toLowerCase();
}

/** DKIM-Signature is `v=1; a=rsa-sha256; ...; d=domain.com; s=selector; ...` — Gmail's "signed-by" is the `d=` domain. */
function domainFromDkimSignature(value: string): string | undefined {
  const m = value.match(/(?:^|;)\s*d=([^;\s]+)/i);
  return m?.[1]?.toLowerCase();
}

function collectAttachments(payload: Record<string, unknown>, messageId: string): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  const body = payload.body as { attachmentId?: string; size?: number; data?: string } | undefined;
  const filename = String(payload.filename || "");
  const mimeType = String(payload.mimeType || "application/octet-stream");
  const headers = (payload.headers as GmailHeader[]) || [];
  const contentIdRaw = getHeader(headers, "Content-ID");
  const contentLocationRaw = getHeader(headers, "Content-Location");
  const contentId = contentIdRaw
    ? contentIdRaw.replace(/^<|>$/g, "").trim()
    : contentLocationRaw
      ? contentLocationRaw.replace(/^<|>$/g, "").trim()
      : undefined;
  const parts = payload.parts as Record<string, unknown>[] | undefined;

  if (body?.attachmentId) {
    attachments.push({
      attachmentId: body.attachmentId,
      filename: filename || "inline",
      mimeType,
      size: body.size || 0,
      contentId: contentId || undefined,
    });
  } else if (body?.data && mimeType.startsWith("image/")) {
    const b64 = body.data.replace(/-/g, "+").replace(/_/g, "/");
    attachments.push({
      attachmentId: `inline-data:${contentId || filename || messageId}`,
      filename: filename || "inline",
      mimeType,
      size: body.size || 0,
      contentId: contentId || undefined,
      inlineDataUri: `data:${mimeType};base64,${b64}`,
    });
  }

  if (Array.isArray(parts)) {
    for (const p of parts) {
      attachments.push(...collectAttachments(p as Record<string, unknown>, messageId));
    }
  }
  return attachments;
}

// Labels that represent folder/state — excluded from the returned labelIds
// so callers only see meaningful user/category labels.
const FOLDER_LABEL_IDS = new Set([
  "INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "UNREAD",
]);

export type GetThreadResult = {
  messages: ThreadMessageView[];
  /** Union of all labelIds across messages in the thread, excluding folder/state labels. */
  labelIds: string[];
};

export async function getThreadMessages(
  accessToken: string,
  threadId: string,
  opts?: { mailboxKey?: string; priority?: GmailPriority }
): Promise<GetThreadResult> {
  const url = `${GMAIL_API}/threads/${encodeURIComponent(threadId)}?format=full`;
  let res: Response;
  try {
    res = await fetchGmail(
      url,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: opts?.mailboxKey, cost: GMAIL_COST.threadsGet, priority: opts?.priority }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (thread get)"));
  }

  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail thread get ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    id: string;
    messages?: {
      id: string;
      threadId?: string;
      internalDate?: string;
      labelIds?: string[];
      payload?: Record<string, unknown>;
    }[];
  };

  const rawMsgs = data.messages || [];
  const sorted = [...rawMsgs].sort((a, b) => {
    const ta = parseInt(a.internalDate || "0", 10);
    const tb = parseInt(b.internalDate || "0", 10);
    return ta - tb;
  });

  // Collect union of all label ids across messages — extract here so the
  // route doesn't need a second Gmail round-trip to get them.
  const labelIdSet = new Set<string>();
  for (const m of rawMsgs) {
    for (const id of m.labelIds ?? []) {
      if (!FOLDER_LABEL_IDS.has(id)) labelIdSet.add(id);
    }
  }

  const messages: ThreadMessageView[] = [];
  for (const m of sorted) {
    const payload = m.payload || {};
    const headers = (payload.headers as GmailHeader[]) || [];
    const subject = getHeader(headers, "Subject");
    const from = getHeader(headers, "From");
    const to = getHeader(headers, "To");
    const cc = getHeader(headers, "Cc");
    const bcc = getHeader(headers, "Bcc");
    const dateHeader = getHeader(headers, "Date");
    const messageIdHeader = getHeader(headers, "Message-ID");
    let date = dateHeader;
    if (m.internalDate) {
      const ms = parseInt(m.internalDate, 10);
      if (!Number.isNaN(ms)) date = new Date(ms).toISOString();
    }
    const body = collectParts(payload, "text/plain").join("\n\n").trim();
    const bodyHtml = collectParts(payload, "text/html").join("").trim();
    const attachments = collectAttachments(payload, m.id);

    // "Show details" fields — format=full (already fetched above) returns every
    // header, these three just weren't extracted before.
    const replyToHeader = getHeader(headers, "Reply-To");
    const returnPath = getHeader(headers, "Return-Path");
    const dkimSignature = getHeader(headers, "DKIM-Signature");
    const replyTo =
      replyToHeader && replyToHeader.trim().toLowerCase() !== from.trim().toLowerCase()
        ? replyToHeader
        : undefined;
    const mailedBy = returnPath ? domainFromReturnPath(returnPath) : undefined;
    const signedBy = dkimSignature ? domainFromDkimSignature(dkimSignature) : undefined;

    messages.push({
      id: m.id,
      threadId: m.threadId || data.id,
      subject,
      from,
      to,
      cc,
      bcc,
      date: date || new Date().toISOString(),
      body,
      bodyHtml,
      messageIdHeader: messageIdHeader || undefined,
      attachments,
      replyTo,
      mailedBy,
      signedBy,
    });
  }

  return { messages, labelIds: Array.from(labelIdSet) };
}

function toBase64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

const MIME_ALT_BOUNDARY = "----=_PlaceAlt_001";
const MIME_MIXED_BOUNDARY = "----=_PlaceMixed_001";

export type SendAttachment = {
  filename: string;
  mimeType: string;
  base64Data: string;
};

/**
 * Strip HTML tags to derive a plain-text fallback for the alternative MIME
 * part. Converts <br>, <p>, <li> to newlines; <strong>/<em>/etc. just
 * become their inner text. Good enough for the plain-text body that
 * receiving clients without HTML support see — they get readable text.
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildAlternativePart(
  plainText: string,
  trackingPixelUrl?: string,
  htmlBodyInput?: string
): string {
  // If caller supplied real HTML (from a rich-text editor), use it directly
  // and derive a plain-text fallback. Otherwise wrap the plain text in a
  // simple div, matching the previous behaviour for plain-text-only senders.
  const usingRichHtml = !!htmlBodyInput && htmlBodyInput.trim().length > 0;
  const plain = usingRichHtml ? htmlToPlainText(htmlBodyInput!) : plainText;
  const rawHtml = usingRichHtml
    ? htmlBodyInput!
    : `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${escapeHtml(plainText)}</div>`;
  const htmlBody = trackingPixelUrl
    ? `${rawHtml}<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`
    : rawHtml;

  return [
    `--${MIME_ALT_BOUNDARY}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plain,
    `--${MIME_ALT_BOUNDARY}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlBody,
    `--${MIME_ALT_BOUNDARY}--`,
  ].join("\r\n");
}

function buildMimeBody(
  plainText: string,
  trackingPixelUrl?: string,
  attachments?: SendAttachment[],
  htmlBody?: string
): { contentType: string; body: string } {
  const altPart = buildAlternativePart(plainText, trackingPixelUrl, htmlBody);

  if (!attachments || attachments.length === 0) {
    return {
      contentType: `multipart/alternative; boundary="${MIME_ALT_BOUNDARY}"`,
      body: altPart,
    };
  }

  const parts: string[] = [
    `--${MIME_MIXED_BOUNDARY}`,
    `Content-Type: multipart/alternative; boundary="${MIME_ALT_BOUNDARY}"`,
    "",
    altPart,
  ];

  for (const att of attachments) {
    parts.push(
      `--${MIME_MIXED_BOUNDARY}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${att.filename}"`,
      "",
      att.base64Data
    );
  }

  parts.push(`--${MIME_MIXED_BOUNDARY}--`);

  return {
    contentType: `multipart/mixed; boundary="${MIME_MIXED_BOUNDARY}"`,
    body: parts.join("\r\n"),
  };
}

export async function sendMailViaGmail(
  accessToken: string,
  options: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    textBody: string;
    /** Optional rich HTML body. If provided, the MIME message uses this
     *  directly as the text/html part and derives the text/plain part
     *  from it. Otherwise textBody is wrapped in a simple HTML envelope. */
    htmlBody?: string;
    threadId?: string;
    inReplyToMessageId?: string;
    references?: string;
    trackingPixelUrl?: string;
    attachments?: SendAttachment[];
    /** Mailbox this send is billed to — scopes the shared quota bucket. */
    mailboxKey?: string;
    /** "batch" for cron-driven sequence sends, so they yield to live traffic. */
    priority?: GmailPriority;
  }
): Promise<{ id: string; threadId: string }> {
  let inReplyTo = "";
  let references = options.references || "";
  let subject = options.subject;

  if (options.inReplyToMessageId) {
    const msgUrl = `${GMAIL_API}/messages/${encodeURIComponent(options.inReplyToMessageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=References`;
    const gm = await fetchGmail(
      msgUrl,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { mailboxKey: options.mailboxKey, cost: GMAIL_COST.messagesGet, priority: options.priority }
    );
    if (gm.ok) {
      const meta = (await gm.json()) as {
        payload?: { headers?: GmailHeader[] };
      };
      const headers = meta.payload?.headers || [];
      const mid = getHeader(headers, "Message-ID");
      const sub = getHeader(headers, "Subject");
      const ref = getHeader(headers, "References");
      if (mid) inReplyTo = mid;
      if (sub && options.subject.trim() === "") {
        subject = /^Re:\s/i.test(sub) ? sub : `Re: ${sub}`;
      }
      if (ref && inReplyTo) {
        references = `${ref} ${inReplyTo}`.trim();
      } else if (inReplyTo) {
        references = inReplyTo;
      }
    }
  }

  const subj = (subject || "").trim() || "(no subject)";
  const { contentType, body: mimeBody } = buildMimeBody(
    options.textBody,
    options.trackingPixelUrl,
    options.attachments,
    options.htmlBody
  );

  const rawLines = [
    `To: ${options.to}`,
    ...(options.cc ? [`Cc: ${options.cc}`] : []),
    ...(options.bcc ? [`Bcc: ${options.bcc}`] : []),
    `Subject: ${subj}`,
    "MIME-Version: 1.0",
    `Content-Type: ${contentType}`,
  ];
  if (inReplyTo) rawLines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) rawLines.push(`References: ${references}`);
  rawLines.push("", mimeBody);
  const raw = rawLines.join("\r\n");
  const encoded = toBase64Url(Buffer.from(raw, "utf8"));

  const body: { raw: string; threadId?: string } = { raw: encoded };
  if (options.threadId) body.threadId = options.threadId;

  const sendUrl = `${GMAIL_API}/messages/send`;
  let res: Response;
  try {
    res = await fetchGmail(
      sendUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      { mailboxKey: options.mailboxKey, cost: GMAIL_COST.messagesSend, priority: options.priority }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Gmail API (send)"));
  }

  if (res.status === 401) {
    const err = new Error("UNAUTHORIZED") as Error & { code?: string };
    err.code = "UNAUTHORIZED";
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    throwIfGmailInsufficientScope(res.status, text);
    throw new Error(`Gmail send ${res.status}: ${text}`);
  }

  const sent = (await res.json()) as { id: string; threadId: string };
  return { id: sent.id, threadId: sent.threadId };
}


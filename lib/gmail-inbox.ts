import { describeUpstreamFetchError } from "@/lib/fetch-errors";
import { throwIfGmailInsufficientScope } from "@/lib/gmail-scope-error";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export type MailFolder = "inbox" | "sent" | "drafts";

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
};

export type ThreadListPage = {
  threads: ThreadListItem[];
  nextPageToken?: string;
};

type ThreadListFolder = Exclude<MailFolder, "drafts">;

const LABELS: Record<ThreadListFolder, string[]> = {
  inbox: ["INBOX"],
  sent: ["SENT"],
};

const QUERY: Record<ThreadListFolder, string> = {
  inbox: "category:primary",
  sent: "",
};

async function fetchMessageMeta(
  accessToken: string,
  messageId: string,
  opts?: { includeTo?: boolean }
): Promise<{ subject: string; from: string; date: string; to?: string; labelIds?: string[] }> {
  const params = new URLSearchParams({ format: "metadata" });
  params.append("metadataHeaders", "Subject");
  params.append("metadataHeaders", "From");
  params.append("metadataHeaders", "Date");
  if (opts?.includeTo) params.append("metadataHeaders", "To");
  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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
    return {
      subject: get("Subject"),
      from: get("From"),
      date,
      labelIds: data.labelIds ?? [],
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
  }
): Promise<ThreadListPage> {
  const params = new URLSearchParams({
    maxResults: String(Math.min(Math.max(options.maxResults, 1), 100)),
  });
  if (options.pageToken) params.set("pageToken", options.pageToken);
  const q = (options.searchQuery || "").trim();
  if (q) params.set("q", q);

  const url = `${GMAIL_API}/drafts?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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
      const threadId = d.message?.threadId || messageId;
      const snippet = d.message?.snippet || "";
      if (!messageId) {
        return {
          id: threadId,
          snippet,
          subject: "(no subject)",
          from: "",
          date: "",
          draftId: d.id,
        };
      }
      const meta = await fetchMessageMeta(accessToken, messageId, { includeTo: true });
      const toLine = (meta.to || "").trim();
      const displayLine = toLine || meta.from.trim() || "Draft";
      return {
        id: threadId,
        snippet: snippet || meta.subject || "",
        subject: meta.subject,
        from: displayLine,
        date: meta.date,
        draftId: d.id,
      };
    })
  );

  return { threads, nextPageToken: data.nextPageToken };
}

export async function listThreadsPage(
  accessToken: string,
  options: {
    folder: ThreadListFolder;
    maxResults: number;
    pageToken?: string;
    /** Gmail search terms (same syntax as Gmail search box), AND-ed with folder filters. */
    searchQuery?: string;
  }
): Promise<ThreadListPage> {
  const labels = LABELS[options.folder];
  const baseQ = QUERY[options.folder];
  const userQ = (options.searchQuery || "").trim();
  const q = [baseQ, userQ].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    maxResults: String(Math.min(Math.max(options.maxResults, 1), 100)),
  });
  for (const l of labels) params.append("labelIds", l);
  if (q) params.set("q", q);
  if (options.pageToken) params.set("pageToken", options.pageToken);

  const url = `${GMAIL_API}/threads?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (e) {
    throw new Error(
      describeUpstreamFetchError(e, "Gmail API (threads list)")
    );
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

  const rawThreads = data.threads || [];

  const threads: ThreadListItem[] = await Promise.all(
    rawThreads.map(async (t) => {
      const meta = await fetchMessageMeta(accessToken, t.id);
      return {
        id: t.id,
        snippet: t.snippet || "",
        subject: meta.subject,
        from: meta.from,
        date: meta.date,
        historyId: t.historyId,
        unread: (meta.labelIds ?? []).includes("UNREAD"),
      };
    })
  );

  return { threads, nextPageToken: data.nextPageToken };
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
};

export type ThreadMessageView = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  bodyHtml: string;
  messageIdHeader?: string;
  attachments: AttachmentInfo[];
};

function collectAttachments(payload: Record<string, unknown>, messageId: string): AttachmentInfo[] {
  const attachments: AttachmentInfo[] = [];
  const body = payload.body as { attachmentId?: string; size?: number } | undefined;
  const filename = String(payload.filename || "");
  const mimeType = String(payload.mimeType || "");
  const parts = payload.parts as Record<string, unknown>[] | undefined;

  if (filename && body?.attachmentId) {
    attachments.push({
      attachmentId: body.attachmentId,
      filename,
      mimeType,
      size: body.size || 0,
    });
  }

  if (Array.isArray(parts)) {
    for (const p of parts) {
      attachments.push(...collectAttachments(p as Record<string, unknown>, messageId));
    }
  }
  return attachments;
}

export async function getThreadMessages(
  accessToken: string,
  threadId: string
): Promise<ThreadMessageView[]> {
  const url = `${GMAIL_API}/threads/${encodeURIComponent(threadId)}?format=full`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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
      payload?: Record<string, unknown>;
    }[];
  };

  const rawMsgs = data.messages || [];
  const sorted = [...rawMsgs].sort((a, b) => {
    const ta = parseInt(a.internalDate || "0", 10);
    const tb = parseInt(b.internalDate || "0", 10);
    return ta - tb;
  });

  const out: ThreadMessageView[] = [];
  const messages = sorted;

  for (const m of messages) {
    const payload = m.payload || {};
    const headers = (payload.headers as GmailHeader[]) || [];
    const subject = getHeader(headers, "Subject");
    const from = getHeader(headers, "From");
    const to = getHeader(headers, "To");
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
    out.push({
      id: m.id,
      threadId: m.threadId || data.id,
      subject,
      from,
      to,
      date: date || new Date().toISOString(),
      body,
      bodyHtml,
      messageIdHeader: messageIdHeader || undefined,
      attachments,
    });
  }

  return out;
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

function buildAlternativePart(plainText: string, trackingPixelUrl?: string): string {
  const htmlBody = trackingPixelUrl
    ? `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${escapeHtml(plainText)}</div><img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`
    : `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${escapeHtml(plainText)}</div>`;

  return [
    `--${MIME_ALT_BOUNDARY}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plainText,
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
  attachments?: SendAttachment[]
): { contentType: string; body: string } {
  const altPart = buildAlternativePart(plainText, trackingPixelUrl);

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
    threadId?: string;
    inReplyToMessageId?: string;
    references?: string;
    trackingPixelUrl?: string;
    attachments?: SendAttachment[];
  }
): Promise<{ id: string; threadId: string }> {
  let inReplyTo = "";
  let references = options.references || "";
  let subject = options.subject;

  if (options.inReplyToMessageId) {
    const msgUrl = `${GMAIL_API}/messages/${encodeURIComponent(options.inReplyToMessageId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject&metadataHeaders=References`;
    const gm = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
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
    options.attachments
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
    res = await fetch(sendUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
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


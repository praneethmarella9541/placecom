import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2045: base64 bodies in MIME should be wrapped at 76 columns. */
function formatMimeBase64(b64: string): string {
  const clean = b64.replace(/\s/g, "");
  const lines: string[] = [];
  for (let i = 0; i < clean.length; i += 76) {
    lines.push(clean.slice(i, i + 76));
  }
  return lines.join("\r\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

type DraftAttachment = {
  filename: string;
  mimeType: string;
  /** Standard base64 (with padding) — same format the send route uses. */
  base64Data: string;
};

/** Best-effort HTML → plain-text fallback for the multipart/alternative
 *  text part. Kept simple — receiving plain-text clients only need readable
 *  content, not a perfect render. */
function htmlToPlain(html: string): string {
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

function buildRaw(opts: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  /** Optional rich HTML. When present, used as the text/html part directly
   *  and a derived plain-text version is written to the text/plain part. */
  htmlBody?: string;
  attachments?: DraftAttachment[];
}): string {
  const altBoundary = "----=_DraftAlt_001";
  const mixedBoundary = "----=_DraftMixed_001";
  const usingRichHtml = !!opts.htmlBody && opts.htmlBody.trim().length > 0;
  const plain = usingRichHtml ? htmlToPlain(opts.htmlBody!) : opts.textBody;
  const html = usingRichHtml
    ? opts.htmlBody!
    : `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${escapeHtml(opts.textBody)}</div>`;

  const altPart = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plain,
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${altBoundary}--`,
  ].join("\r\n");

  const hasAttachments = (opts.attachments?.length ?? 0) > 0;

  const headerLines = [
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${(opts.subject || "").trim() || "(no subject)"}`,
    "MIME-Version: 1.0",
  ];

  let bodyMime: string;
  if (!hasAttachments) {
    headerLines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
    bodyMime = altPart;
  } else {
    headerLines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    const parts: string[] = [
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      altPart,
    ];
    for (const att of opts.attachments!) {
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${att.mimeType}; name="${att.filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${att.filename}"`,
        "",
        formatMimeBase64(att.base64Data)
      );
    }
    parts.push(`--${mixedBoundary}--`);
    bodyMime = parts.join("\r\n");
  }

  const mime = [...headerLines, "", bodyMime].join("\r\n");
  return toBase64Url(Buffer.from(mime, "utf8"));
}

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const draftId = searchParams.get("draftId");
  if (!draftId) {
    return NextResponse.json({ error: "draftId required" }, { status: 400 });
  }

  const res = await fetch(`${GMAIL_API}/drafts/${encodeURIComponent(draftId)}?format=full`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Gmail error ${res.status}: ${text}` }, { status: res.status });
  }

  const data = (await res.json()) as {
    id: string;
    message?: {
      id: string;
      threadId: string;
      payload?: { headers?: { name: string; value: string }[]; parts?: unknown[]; body?: { data?: string } };
    };
  };

  const headers = data.message?.payload?.headers ?? [];
  const get = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  type MimePart = {
    mimeType?: string;
    filename?: string;
    headers?: { name: string; value: string }[];
    body?: { data?: string; attachmentId?: string; size?: number };
    parts?: MimePart[];
  };

  function filenameFromPart(part: MimePart): string {
    if (part.filename?.trim()) return part.filename.trim();
    const cd =
      part.headers?.find((h) => h.name.toLowerCase() === "content-disposition")?.value ?? "";
    const quoted = /filename\*?=(?:UTF-8''|")([^";\n]+)/i.exec(cd);
    if (quoted?.[1]) return decodeURIComponent(quoted[1].replace(/"/g, ""));
    const plain = /filename=([^;\s]+)/i.exec(cd);
    if (plain?.[1]) return plain[1].replace(/"/g, "");
    return "";
  }

  function collectText(payload: MimePart): string {
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      const b64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    if (Array.isArray(payload.parts)) {
      for (const part of payload.parts) {
        const text = collectText(part);
        if (text) return text;
      }
    }
    return '';
  }

  function collectHtml(payload: MimePart): string {
    if (payload.mimeType === 'text/html' && payload.body?.data) {
      const b64 = payload.body.data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    if (Array.isArray(payload.parts)) {
      for (const part of payload.parts) {
        const html = collectHtml(part);
        if (html) return html;
      }
    }
    return '';
  }

  function collectAttachments(payload: MimePart): Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> {
    const results: Array<{ attachmentId: string; filename: string; mimeType: string; size: number }> = [];
    const mime = payload.mimeType ?? "";
    if (payload.body?.attachmentId && !mime.startsWith("multipart/")) {
      const name = filenameFromPart(payload);
      results.push({
        attachmentId: payload.body.attachmentId,
        filename: name || `attachment-${payload.body.attachmentId.slice(0, 8)}`,
        mimeType: mime || "application/octet-stream",
        size: payload.body.size ?? 0,
      });
    }
    if (Array.isArray(payload.parts)) {
      for (const part of payload.parts) {
        results.push(...collectAttachments(part));
      }
    }
    return results;
  }

  const messageId = data.message?.id ?? '';
  const payload = (data.message?.payload ?? {}) as MimePart;

  return NextResponse.json({
    draftId: data.id,
    messageId,
    threadId: data.message?.threadId,
    to: get('To'),
    cc: get('Cc'),
    bcc: get('Bcc'),
    subject: get('Subject'),
    textBody: collectText(payload),
    htmlBody: collectHtml(payload),
    attachments: collectAttachments(payload).map((a) => ({ ...a, messageId })),
  });
}

type Body = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  textBody?: string;
  /** Optional rich HTML body from the compose editor. When present, used
   *  directly as the MIME text/html part and the text/plain part is
   *  derived from it via tag stripping. Mobile callers can omit this. */
  htmlBody?: string;
  draftId?: string; // if set, update existing draft
  threadId?: string;
  /** Standard-base64 attachment data — same shape the send route accepts. */
  attachments?: DraftAttachment[];
};

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = buildRaw({
    to: body.to ?? "",
    cc: body.cc,
    bcc: body.bcc,
    subject: body.subject ?? "",
    textBody: body.textBody ?? "",
    htmlBody: body.htmlBody,
    attachments: body.attachments,
  });

  const message: Record<string, unknown> = { raw };
  if (body.threadId) message.threadId = body.threadId;

  try {
    let res: Response;
    if (body.draftId) {
      // Update existing draft
      res = await fetch(`${GMAIL_API}/drafts/${encodeURIComponent(body.draftId)}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });
    } else {
      // Create new draft
      res = await fetch(`${GMAIL_API}/drafts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
      });
    }

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Gmail drafts error ${res.status}: ${text}` }, { status: res.status });
    }

    const data = (await res.json()) as { id: string; message?: { id: string; threadId: string } };
    return NextResponse.json({ draftId: data.id, messageId: data.message?.id, threadId: data.message?.threadId });
  } catch (e) {
    const err = e as Error;
    console.error("[drafts]", err);
    return NextResponse.json({ error: err.message || "Failed to save draft" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const draftId = searchParams.get("draftId");
  if (!draftId) {
    return NextResponse.json({ error: "draftId required" }, { status: 400 });
  }

  const res = await fetch(`${GMAIL_API}/drafts/${encodeURIComponent(draftId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });

  // 204 No Content = success; 404 = already gone — both are fine
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    return NextResponse.json({ error: `Gmail error ${res.status}: ${text}` }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

function buildRaw(opts: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
}): string {
  const boundary = "----=_DraftAlt_001";
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${escapeHtml(opts.textBody)}</div>`;
  const mime = [
    `To: ${opts.to}`,
    ...(opts.cc ? [`Cc: ${opts.cc}`] : []),
    ...(opts.bcc ? [`Bcc: ${opts.bcc}`] : []),
    `Subject: ${(opts.subject || "").trim() || "(no subject)"}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    opts.textBody,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}--`,
  ].join("\r\n");
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

  // Extract plain text body from payload
  function collectText(payload: unknown): string {
    const p = payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
    if (p.mimeType === 'text/plain' && p.body?.data) {
      const b64 = p.body.data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(b64, 'base64').toString('utf8');
    }
    if (Array.isArray(p.parts)) {
      for (const part of p.parts) {
        const text = collectText(part);
        if (text) return text;
      }
    }
    return '';
  }

  return NextResponse.json({
    draftId: data.id,
    messageId: data.message?.id,
    threadId: data.message?.threadId,
    to: get('To'),
    cc: get('Cc'),
    bcc: get('Bcc'),
    subject: get('Subject'),
    textBody: collectText(data.message?.payload ?? {}),
  });
}

type Body = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  textBody?: string;
  draftId?: string; // if set, update existing draft
  threadId?: string;
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

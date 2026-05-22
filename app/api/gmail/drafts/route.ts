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

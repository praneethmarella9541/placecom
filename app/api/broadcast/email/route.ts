import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { sendMailViaGmail, type SendAttachment } from "@/lib/gmail-inbox";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";
import { isValidEmail } from "@/lib/broadcast-recipients";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_RECIPIENTS = 80;
const MS_BETWEEN_SENDS = 250;

type AttachmentPayload = {
  filename: string;
  mimeType: string;
  base64Data: string;
};

type Body = {
  recipients: string[];
  subject: string;
  textBody: string;
  /** Rich HTML from RichTextEditor (components/RichTextEditor.tsx) — the web
   *  compose flow always sends this now, textBody empty; sendMailViaGmail
   *  derives the text/plain part from it. */
  htmlBody?: string;
  attachments?: AttachmentPayload[];
};

/** Mirrors richTextIsEmpty (components/RichTextEditor.tsx) without importing a "use client" module here. */
function isBlankHtml(html: string): boolean {
  return (
    html
      .replace(/<br\s*\/?>/gi, "")
      .replace(/<p[^>]*><\/p>/gi, "")
      .replace(/<div[^>]*><\/div>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .trim().length === 0
  );
}

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

  const rawList = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients = Array.from(
    new Set(
      rawList
        .map((r) => String(r).trim().toLowerCase())
        .filter((r) => r.length > 0 && isValidEmail(r))
    )
  );

  if (recipients.length === 0) {
    return NextResponse.json({ error: "Add at least one valid recipient email" }, { status: 400 });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `Too many recipients (max ${MAX_RECIPIENTS} per batch)` },
      { status: 400 }
    );
  }

  const subject = (body.subject ?? "").trim();
  const textBody = body.textBody ?? "";
  const htmlBody = body.htmlBody ?? "";
  if (!subject) {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }
  if (!textBody.trim() && isBlankHtml(htmlBody)) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  const attachments: SendAttachment[] | undefined = body.attachments?.map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType || "application/octet-stream",
    base64Data: a.base64Data,
  }));

  const sentOk: string[] = [];
  const failed: { email: string; error: string }[] = [];

  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i];
    try {
      await sendMailViaGmail(auth.accessToken, {
        to,
        subject,
        textBody,
        htmlBody: htmlBody || undefined,
        attachments,
      });
      sentOk.push(to);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "UNAUTHORIZED") {
        return NextResponse.json(
          {
            error: "Google token expired. Sign in again.",
            sent: sentOk,
            failed: [...failed, { email: to, error: err.message }],
          },
          { status: 401 }
        );
      }
      if (err.code === GMAIL_INSUFFICIENT_SCOPE) {
        return NextResponse.json(
          { error: err.message, sent: sentOk, failed },
          { status: 403 }
        );
      }
      failed.push({ email: to, error: err.message || "Send failed" });
    }
    if (i < recipients.length - 1) {
      await new Promise((r) => setTimeout(r, MS_BETWEEN_SENDS));
    }
  }

  return NextResponse.json({
    sent: sentOk.length,
    failed,
    recipients: recipients.length,
  });
}

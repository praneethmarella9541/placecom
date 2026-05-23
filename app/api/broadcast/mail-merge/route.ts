import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { sendMailViaGmail, type SendAttachment } from "@/lib/gmail-inbox";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { mergeTemplate, type MailMergeRow } from "@/lib/mail-merge";

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
  subjectTemplate: string;
  bodyTemplate: string;
  rows: MailMergeRow[];
  attachments?: AttachmentPayload[];
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

  const subjectTemplate = (body.subjectTemplate ?? "").trim();
  const bodyTemplate = body.bodyTemplate ?? "";
  if (!subjectTemplate) {
    return NextResponse.json({ error: "Subject template is required" }, { status: 400 });
  }
  if (!bodyTemplate.trim()) {
    return NextResponse.json({ error: "Message body template is required" }, { status: 400 });
  }

  const rawRows = Array.isArray(body.rows) ? body.rows : [];
  const rows: MailMergeRow[] = [];
  const seen = new Set<string>();

  for (const r of rawRows) {
    const email = String(r?.email ?? r?.fields?.email ?? "")
      .trim()
      .toLowerCase();
    if (!email || !isValidEmail(email) || seen.has(email)) continue;
    seen.add(email);
    rows.push({
      email,
      fields: { ...(r.fields || {}), email },
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Add at least one valid recipient row" }, { status: 400 });
  }
  if (rows.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `Too many recipients (max ${MAX_RECIPIENTS} per batch)` },
      { status: 400 }
    );
  }

  const attachments: SendAttachment[] | undefined = body.attachments?.map((a) => ({
    filename: a.filename,
    mimeType: a.mimeType || "application/octet-stream",
    base64Data: a.base64Data,
  }));

  const sentOk: string[] = [];
  const failed: { email: string; error: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const subject = mergeTemplate(subjectTemplate, row.fields);
    const textBody = mergeTemplate(bodyTemplate, row.fields);

    try {
      await sendMailViaGmail(auth.accessToken, {
        to: row.email,
        subject,
        textBody,
        attachments,
      });
      sentOk.push(row.email);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "UNAUTHORIZED") {
        return NextResponse.json(
          {
            error: "Google token expired. Sign in again.",
            sent: sentOk.length,
            failed: [...failed, { email: row.email, error: err.message }],
          },
          { status: 401 }
        );
      }
      if (err.code === GMAIL_INSUFFICIENT_SCOPE) {
        return NextResponse.json(
          { error: err.message, sent: sentOk.length, failed },
          { status: 403 }
        );
      }
      failed.push({ email: row.email, error: err.message || "Send failed" });
    }
    if (i < rows.length - 1) {
      await new Promise((r) => setTimeout(r, MS_BETWEEN_SENDS));
    }
  }

  return NextResponse.json({
    sent: sentOk.length,
    failed,
    recipients: rows.length,
  });
}

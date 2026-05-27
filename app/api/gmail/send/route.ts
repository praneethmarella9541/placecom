import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { sendMailViaGmail, type SendAttachment } from "@/lib/gmail-inbox";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const maxDuration = 60;

type AttachmentPayload = {
  filename: string;
  mimeType: string;
  base64Data: string;
};

type Body = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  /** Optional rich HTML body. Mobile callers can omit this and keep the
   *  existing text-only behaviour; web compose sends it for formatted mail. */
  htmlBody?: string;
  threadId?: string;
  inReplyToMessageId?: string;
  attachments?: AttachmentPayload[];
};

function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
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

  const to = body.to?.trim();
  const cc = body.cc?.trim() || undefined;
  const bcc = body.bcc?.trim() || undefined;
  const subject = body.subject?.trim() ?? "";
  const textBody = body.textBody ?? "";
  if (!to) {
    return NextResponse.json({ error: "to is required" }, { status: 400 });
  }

  // Use service role for tracking writes so this works for both cookie (web)
  // and Bearer (mobile) requests.
  let supabase;
  try {
    supabase = createServiceSupabase();
  } catch {
    supabase = createServerSupabaseClient();
  }

  let trackRow: { id: string } | null = null;
  try {
    const { data } = await supabase
      .from("email_tracking")
      .insert({
        user_id: auth.userId,
        gmail_message_id: "__pending__",
        to_address: to,
        subject: subject || null,
      })
      .select("id")
      .single();
    trackRow = data;
  } catch {
    // tracking table may not exist yet — continue without tracking
  }

  const trackingPixelUrl = trackRow
    ? `${getAppUrl()}/api/track/${trackRow.id}`
    : undefined;

  try {
    const attachments: SendAttachment[] | undefined = body.attachments?.map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      base64Data: a.base64Data,
    }));

    const sent = await sendMailViaGmail(auth.accessToken, {
      to,
      cc,
      bcc,
      subject,
      textBody,
      htmlBody: body.htmlBody,
      threadId: body.threadId,
      inReplyToMessageId: body.inReplyToMessageId,
      trackingPixelUrl,
      attachments,
    });

    if (trackRow) {
      await supabase
        .from("email_tracking")
        .update({ gmail_message_id: sent.id })
        .eq("id", trackRow.id);
    }

    return NextResponse.json(sent);
  } catch (e) {
    if (trackRow) {
      await supabase.from("email_tracking").delete().eq("id", trackRow.id);
    }

    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === GMAIL_INSUFFICIENT_SCOPE) {
      return NextResponse.json(
        { error: GMAIL_INSUFFICIENT_SCOPE, message: err.message },
        { status: 403 }
      );
    }
    console.error(e);
    return NextResponse.json(
      { error: err.message || "Failed to send" },
      { status: 500 }
    );
  }
}

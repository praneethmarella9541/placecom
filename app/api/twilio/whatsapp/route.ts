import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";
import { getTwilioWebhookBaseUrl } from "@/lib/call-recording-url";
import { getWhatsAppFromAddress } from "@/lib/whatsapp";
import { peerFromInboundWebhook, stripWhatsAppPrefix } from "@/lib/whatsapp-address";
import { normalizePhone } from "@/lib/phone";
import { findUserIdForBusinessLine } from "@/lib/whatsapp-telephony";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formToParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });
  return params;
}

function validateTwilioSignature(
  authToken: string,
  requestUrl: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  if (twilio.validateRequest(authToken, signature, requestUrl, params)) return true;
  const base = getTwilioWebhookBaseUrl()?.replace(/\/+$/, "");
  if (base) {
    const path = new URL(requestUrl).pathname + new URL(requestUrl).search;
    const alt = `${base}${path}`;
    if (twilio.validateRequest(authToken, signature, alt, params)) return true;
  }
  return false;
}

/**
 * Twilio inbound (and some status) callbacks for WhatsApp.
 * Configure on your WhatsApp sender: POST to this route (public HTTPS).
 */
export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!authToken) {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const signature = request.headers.get("X-Twilio-Signature") || "";
  const form = await request.formData();
  const params = formToParams(form);

  if (!validateTwilioSignature(authToken, request.url, params, signature)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const messageSid = params.MessageSid?.trim();
  const from = params.From?.trim() || "";
  const to = params.To?.trim() || "";
  const body = params.Body ?? "";
  const numMedia = Number.parseInt(params.NumMedia || "0", 10) || 0;
  /** WhatsApp quoted reply (Twilio; ~7d window). See https://www.twilio.com/en-us/changelog/whatsapp-inbound-messages-will-now-include-reply-context */
  const originalRepliedSid = params.OriginalRepliedMessageSid?.trim() || "";

  if (!messageSid || !from || !to) {
    return twimlOk();
  }

  if (!supabaseUrl || !serviceKey) {
    console.warn("[twilio/whatsapp] SUPABASE_SERVICE_ROLE_KEY missing; inbound message not stored");
    return twimlOk();
  }

  if (!getWhatsAppFromAddress()) {
    return twimlOk();
  }

  let peer: string;
  try {
    peer = peerFromInboundWebhook(from, to);
  } catch {
    return twimlOk();
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const displayBody =
    body.length > 0 ? body : numMedia > 0 ? `[${numMedia} attachment(s)]` : "";

  let replyToId: string | null = null;
  if (originalRepliedSid) {
    const { data: parent } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("message_sid", originalRepliedSid)
      .maybeSingle();
    if (parent?.id) replyToId = parent.id as string;
  }

  const ourFrom = getWhatsAppFromAddress();
  const businessE164 = ourFrom
    ? normalizePhone(stripWhatsAppPrefix(ourFrom))
    : normalizePhone(stripWhatsAppPrefix(to));
  const ownerUserId = businessE164 ? await findUserIdForBusinessLine(businessE164) : null;

  const insertRow: Record<string, unknown> = {
    user_id: ownerUserId,
    direction: "inbound",
    peer_e164: peer,
    business_e164: businessE164 || null,
    from_addr: from,
    to_addr: to,
    body: displayBody || null,
    message_sid: messageSid,
    num_media: numMedia,
  };
  if (replyToId) insertRow.reply_to_id = replyToId;

  const { error } = await supabase.from("whatsapp_messages").insert(insertRow);

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return twimlOk();
    }
    if (error.message.includes("does not exist") || (error as { code?: string }).code === "42P01") {
      console.warn("[twilio/whatsapp] whatsapp_messages table missing:", error.message);
      return twimlOk();
    }
    console.error("[twilio/whatsapp] insert error:", error);
  }

  return twimlOk();
}

function twimlOk(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

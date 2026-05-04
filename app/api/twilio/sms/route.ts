import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";
import { getTwilioWebhookBaseUrl } from "@/lib/call-recording-url";
import { getTwilioFromNumber } from "@/lib/twilio";
import { peerFromSmsWebhook } from "@/lib/sms-address";

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
 * Twilio inbound SMS for your voice/SMS number.
 * In Twilio Console → Phone number → "A message comes in" (SMS): POST to this URL (public HTTPS).
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

  if (!messageSid || !from || !to) {
    return emptySmsResponse();
  }

  if (/^whatsapp:/i.test(from) || /^whatsapp:/i.test(to)) {
    return emptySmsResponse();
  }

  if (!supabaseUrl || !serviceKey) {
    console.warn("[twilio/sms] SUPABASE_SERVICE_ROLE_KEY missing; inbound SMS not stored");
    return emptySmsResponse();
  }

  if (!getTwilioFromNumber()) {
    return emptySmsResponse();
  }

  let peer: string;
  try {
    peer = peerFromSmsWebhook(from, to);
  } catch {
    return emptySmsResponse();
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const displayBody = body.trim() || null;

  const { error } = await supabase.from("sms_messages").insert({
    user_id: null,
    direction: "inbound",
    peer_e164: peer,
    from_addr: from,
    to_addr: to,
    body: displayBody,
    message_sid: messageSid,
  });

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return emptySmsResponse();
    }
    if (error.message.includes("does not exist") || (error as { code?: string }).code === "42P01") {
      console.warn("[twilio/sms] sms_messages table missing:", error.message);
      return emptySmsResponse();
    }
    console.error("[twilio/sms] insert error:", error);
  }

  return emptySmsResponse();
}

function emptySmsResponse(): NextResponse {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

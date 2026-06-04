import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  extractExotelInboundBody,
  getExotelAccountSid,
} from "@/lib/exotel-whatsapp";
import { normalizePhone } from "@/lib/phone";
import { findUserIdForBusinessLine } from "@/lib/whatsapp-telephony";
import { normalizePeerE164 } from "@/lib/whatsapp-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookBody = {
  type?: string;
  challenge?: string;
  account_sid?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
};

function ok(): NextResponse {
  return new NextResponse("OK", { status: 200 });
}

export async function POST(request: Request) {
  let body: WebhookBody;
  try {
    body = (await request.json()) as WebhookBody;
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  if (body.type === "verification" && body.challenge) {
    return NextResponse.json({ challenge: body.challenge });
  }

  const expectedSid = getExotelAccountSid();
  if (expectedSid && body.account_sid && body.account_sid !== expectedSid) {
    return new NextResponse("Unauthorized", { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.warn("[exotel/whatsapp] SUPABASE_SERVICE_ROLE_KEY missing");
    return ok();
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const data = body.data ?? {};

  if (body.type === "message_status") {
    const messageSid = String(data.message_sid ?? "").trim();
    const status = String(data.status ?? "").trim();
    if (messageSid && status) {
      await supabase
        .from("whatsapp_messages")
        .update({ delivery_status: status })
        .eq("message_sid", messageSid);
    }
    return ok();
  }

  if (body.type !== "inbound_message") {
    return ok();
  }

  const messageSid = String(data.message_sid ?? "").trim();
  const fromRaw = String(data.from ?? "").trim();
  const toRaw = String(data.to ?? "").trim();
  if (!messageSid || !fromRaw || !toRaw) {
    return ok();
  }

  const businessE164 = normalizePhone(toRaw);
  const peerE164 = normalizePeerE164(fromRaw);
  const message = data.message as Record<string, unknown> | undefined;
  const { body: textBody, numMedia } = extractExotelInboundBody(message);
  const displayBody = textBody || (numMedia > 0 ? `[${numMedia} attachment(s)]` : "");

  const ownerUserId = await findUserIdForBusinessLine(businessE164);

  const { error } = await supabase.from("whatsapp_messages").insert({
    user_id: ownerUserId,
    direction: "inbound",
    peer_e164: peerE164,
    business_e164: businessE164,
    from_addr: fromRaw,
    to_addr: toRaw,
    body: displayBody || null,
    message_sid: messageSid,
    num_media: numMedia,
  });

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return ok();
    }
    if (error.message.includes("does not exist") || (error as { code?: string }).code === "42P01") {
      console.warn("[exotel/whatsapp] whatsapp_messages table missing:", error.message);
      return ok();
    }
    if (/business_e164/i.test(error.message)) {
      console.warn("[exotel/whatsapp] migration 0024 required:", error.message);
      return ok();
    }
    console.error("[exotel/whatsapp] insert error:", error);
  }

  return ok();
}

export async function GET() {
  return NextResponse.json({ status: "Exotel WhatsApp webhook is live" });
}

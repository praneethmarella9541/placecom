import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getExotelAccountSid } from "@/lib/exotel-whatsapp";
import {
  finalizeInbound,
  formatDeliveryStatusForDb,
  parseExotelInboundWebhook,
  parseExotelStatusWebhook,
} from "@/lib/exotel-webhook-parse";
import { canonicalWhatsAppPeer } from "@/lib/whatsapp-peer";
import { findUserIdForBusinessLine } from "@/lib/whatsapp-telephony";
import { notifyWhatsAppInbound } from "@/lib/push-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(): NextResponse {
  return new NextResponse("OK", { status: 200 });
}

export async function POST(request: Request) {
  const rawText = await request.text();
  let body: Record<string, unknown>;
  try {
    body = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  if (body.type === "verification" || body.event === "verification") {
    const challenge = String(body.challenge ?? "").trim();
    if (challenge) return NextResponse.json({ challenge });
  }

  const expectedSid = getExotelAccountSid();
  const accountSid = String(body.account_sid ?? "").trim();
  if (expectedSid && accountSid && accountSid !== expectedSid) {
    console.warn("[exotel/whatsapp] account_sid mismatch", { expectedSid, accountSid });
    return new NextResponse("Unauthorized", { status: 403 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.warn("[exotel/whatsapp] SUPABASE_SERVICE_ROLE_KEY missing");
    return ok();
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const status = parseExotelStatusWebhook(body);
  if (status) {
    const deliveryStatus = formatDeliveryStatusForDb(status);
    const { data: updated, error: updErr } = await supabase
      .from("whatsapp_messages")
      .update({ delivery_status: deliveryStatus })
      .eq("message_sid", status.messageSid)
      .select("id");

    if (updErr) {
      console.error("[exotel/whatsapp] status update error:", updErr);
    } else if (!updated?.length) {
      console.warn(
        "[exotel/whatsapp] status for unknown message_sid:",
        status.messageSid,
        "|",
        deliveryStatus
      );
    } else {
      console.log(
        "[exotel/whatsapp] delivery | sid:",
        status.messageSid,
        "|",
        deliveryStatus
      );
    }
    return ok();
  }

  const inbound = parseExotelInboundWebhook(body);
  if (!inbound) {
    console.log(
      "[exotel/whatsapp] unhandled webhook keys:",
      Object.keys(body).join(","),
      "| event:",
      body.event ?? body.type ?? "(none)"
    );
    return ok();
  }

  const finalized = await finalizeInbound(inbound);
  if (!finalized) {
    return ok();
  }

  const ownerUserId = await findUserIdForBusinessLine(finalized.businessE164);

  const { error } = await supabase.from("whatsapp_messages").insert({
    user_id: ownerUserId,
    direction: "inbound",
    peer_e164: canonicalWhatsAppPeer(finalized.peerE164),
    business_e164: finalized.businessE164,
    from_addr: finalized.fromRaw,
    to_addr: finalized.toRaw,
    body: finalized.displayBody || null,
    message_sid: finalized.messageSid,
    num_media: finalized.numMedia,
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
    return ok();
  }

  console.log(
    "[exotel/whatsapp] inbound stored | peer:",
    finalized.peerE164,
    "| business:",
    finalized.businessE164,
    "| sid:",
    finalized.messageSid
  );

  void notifyWhatsAppInbound({
    ownerUserId,
    peerE164: canonicalWhatsAppPeer(finalized.peerE164),
    bodyPreview: finalized.displayBody,
    businessE164: finalized.businessE164,
  }).catch((e) => console.warn("[exotel/whatsapp] push:", e));

  return ok();
}

export async function GET() {
  return NextResponse.json({ status: "Exotel WhatsApp webhook is live" });
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getExotelAccountSid } from "@/lib/exotel-whatsapp";
import {
  finalizeInbound,
  formatDeliveryStatusForDb,
  mergeWhatsAppDeliveryStatus,
  parseExotelInboundWebhook,
  parseExotelStatusWebhook,
} from "@/lib/exotel-webhook-parse";
import { canonicalWhatsAppPeer } from "@/lib/whatsapp-peer";
import { findUserIdForBusinessLine } from "@/lib/whatsapp-telephony";
import { notifyWhatsAppInbound } from "@/lib/push-notifications";
import { fetchAndStoreExotelMedia } from "@/lib/whatsapp-media-storage";

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
    const { data: existing, error: fetchErr } = await supabase
      .from("whatsapp_messages")
      .select("id, delivery_status")
      .eq("message_sid", status.messageSid)
      .maybeSingle();

    if (fetchErr) {
      console.error("[exotel/whatsapp] status lookup error:", fetchErr);
      return ok();
    }
    if (!existing) {
      console.warn(
        "[exotel/whatsapp] status for unknown message_sid:",
        status.messageSid,
        "|",
        deliveryStatus
      );
      // DLR can arrive before /api/whatsapp/send finishes inserting the row.
      await new Promise((r) => setTimeout(r, 2500));
      const { data: retry } = await supabase
        .from("whatsapp_messages")
        .select("id, delivery_status")
        .eq("message_sid", status.messageSid)
        .maybeSingle();
      if (!retry) return ok();
      const mergedRetry = mergeWhatsAppDeliveryStatus(retry.delivery_status, deliveryStatus);
      await supabase
        .from("whatsapp_messages")
        .update({ delivery_status: mergedRetry })
        .eq("message_sid", status.messageSid);
      console.log("[exotel/whatsapp] delivery (retry) | sid:", status.messageSid, "|", mergedRetry);
      return ok();
    }

    const mergedStatus = mergeWhatsAppDeliveryStatus(
      existing.delivery_status,
      deliveryStatus
    );
    const { data: updated, error: updErr } = await supabase
      .from("whatsapp_messages")
      .update({ delivery_status: mergedStatus })
      .eq("message_sid", status.messageSid)
      .select("id");

    if (updErr) {
      console.error("[exotel/whatsapp] status update error:", updErr);
    } else if (!updated?.length) {
      console.warn("[exotel/whatsapp] status update matched no rows:", status.messageSid);
    } else {
      console.log(
        "[exotel/whatsapp] delivery | sid:",
        status.messageSid,
        "|",
        mergedStatus
      );
    }
    return ok();
  }

  // DEBUG: log the full raw payload so we can see exactly what Exotel sends.
  console.log("[exotel/whatsapp] RAW body:", JSON.stringify(body).slice(0, 2000));

  const inbound = parseExotelInboundWebhook(body);
  if (!inbound) {
    const looksLikeStatus =
      Boolean(body.sid || body.message_sid || body.exo_detailed_status || body.exo_status_code) ||
      body.event === "message_status" ||
      body.type === "message_status";
    console.log(
      "[exotel/whatsapp] unhandled webhook keys:",
      Object.keys(body).join(","),
      "| event:",
      body.event ?? body.type ?? "(none)",
      looksLikeStatus ? "| (status-shaped — check parser)" : ""
    );
    return ok();
  }

  console.log("[exotel/whatsapp] parsed inbound:", JSON.stringify({
    messageSid: inbound.messageSid,
    peerE164: inbound.peerE164,
    displayBody: inbound.displayBody,
    numMedia: inbound.numMedia,
    mediaId: inbound.mediaId,
    mediaLink: inbound.mediaLink,
    contentType: inbound.contentType,
  }));

  const finalized = await finalizeInbound(inbound);
  if (!finalized) {
    return ok();
  }

  const ownerUserId = await findUserIdForBusinessLine(finalized.businessE164);

  // Download inbound media and upload to Supabase Storage so the mobile app
  // can load it from a stable public URL without needing Exotel credentials.
  let mediaUrl: string | null = null;
  if (finalized.numMedia > 0) {
    console.log("[exotel/whatsapp] fetching media | mediaId:", finalized.mediaId, "| mediaLink:", finalized.mediaLink, "| msgSid:", finalized.messageSid);
    mediaUrl = await fetchAndStoreExotelMedia({
      mediaLink: finalized.mediaLink,
      mediaId: finalized.mediaId,
      messageSid: finalized.messageSid,
      contentType: finalized.contentType,
      businessE164: finalized.businessE164,
    });
    console.log("[exotel/whatsapp] media upload result:", mediaUrl ?? "FAILED — media_url will be null");
  }

  let replyToId: string | null = null;
  if (finalized.replyToMessageSid) {
    const { data: parent } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("message_sid", finalized.replyToMessageSid)
      .maybeSingle();
    if (parent?.id) replyToId = parent.id as string;
  }

  const insertRow: Record<string, unknown> = {
    user_id: ownerUserId,
    direction: "inbound",
    peer_e164: canonicalWhatsAppPeer(finalized.peerE164),
    business_e164: finalized.businessE164,
    from_addr: finalized.fromRaw,
    to_addr: finalized.toRaw,
    body: finalized.displayBody || null,
    message_sid: finalized.messageSid,
    num_media: finalized.numMedia,
    media_url: mediaUrl,
    content_type: finalized.contentType,
  };
  if (replyToId) insertRow.reply_to_id = replyToId;

  const { error } = await supabase.from("whatsapp_messages").insert(insertRow);

  const pushParams = {
    ownerUserId,
    peerE164: canonicalWhatsAppPeer(finalized.peerE164),
    bodyPreview: finalized.displayBody,
    contentType: finalized.contentType,
    numMedia: finalized.numMedia,
    messageType: finalized.messageType,
    mediaUrl,
    businessE164: finalized.businessE164,
  };

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

  try {
    await notifyWhatsAppInbound(pushParams);
  } catch (e) {
    console.warn("[exotel/whatsapp] push:", e);
  }

  return ok();
}

export async function GET() {
  return NextResponse.json({ status: "Exotel WhatsApp webhook is live" });
}

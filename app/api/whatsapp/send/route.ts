import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTwilioClient } from "@/lib/twilio";
import { getWhatsAppFromAddress, isWhatsAppSendConfigured, sendWhatsAppSessionMessage, toWhatsAppAddress } from "@/lib/whatsapp";
import { peerForOutbound } from "@/lib/whatsapp-address";

export const runtime = "nodejs";

/**
 * Send a WhatsApp session text (same Twilio account; From = WhatsApp-approved sender).
 * Body must comply with WhatsApp policies; use templates for marketing/cold outreach.
 */
export async function POST(request: Request) {
  if (!isWhatsAppSendConfigured()) {
    return NextResponse.json(
      {
        error:
          "WhatsApp is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and register WhatsApp on your number in Twilio (then TWILIO_WHATSAPP_FROM or TWILIO_PHONE_NUMBER as whatsapp sender).",
      },
      { status: 503 },
    );
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { to?: string; text?: string; replyToId?: string } | null;
  const to = body?.to?.trim() || "";
  const text = body?.text?.trim() || "";
  const replyToIdRaw = body?.replyToId?.trim() || "";

  if (!to.startsWith("+") || to.length < 8) {
    return NextResponse.json({ error: "Provide recipient in E.164 format, e.g. +14155552671" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "text (message body) is required" }, { status: 400 });
  }

  const client = getTwilioClient();
  if (!client) {
    return NextResponse.json({ error: "Twilio client unavailable" }, { status: 503 });
  }

  const peerNorm = peerForOutbound(to);
  let replyToId: string | null = null;
  if (replyToIdRaw) {
    const { data: ref, error: refErr } = await supabase
      .from("whatsapp_messages")
      .select("id, peer_e164, deleted_at")
      .eq("id", replyToIdRaw)
      .maybeSingle();
    if (refErr || !ref || ref.deleted_at || ref.peer_e164 !== peerNorm) {
      return NextResponse.json({ error: "Invalid reply reference for this chat" }, { status: 400 });
    }
    replyToId = ref.id as string;
  }

  try {
    const { sid } = await sendWhatsAppSessionMessage(client, { toE164: to, body: text });
    const fromAddr = getWhatsAppFromAddress();
    if (fromAddr) {
      const { error: logErr } = await supabase.from("whatsapp_messages").insert({
        user_id: user.id,
        direction: "outbound",
        peer_e164: peerNorm,
        from_addr: fromAddr,
        to_addr: toWhatsAppAddress(to),
        body: text,
        message_sid: sid,
        num_media: 0,
        reply_to_id: replyToId,
      });
      if (logErr && !String(logErr.message).includes("does not exist")) {
        console.warn("[whatsapp/send] log insert:", logErr.message);
      }
    }
    return NextResponse.json({ ok: true, messageSid: sid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send WhatsApp message";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

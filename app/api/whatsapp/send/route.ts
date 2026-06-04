import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { sendExotelWhatsAppText, isExotelWhatsAppConfigured } from "@/lib/exotel-whatsapp";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";
import { peerForOutbound } from "@/lib/whatsapp-address";
import { isValidE164, normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

/**
 * Send a WhatsApp session text via Exotel (from = user's assigned Exotel line).
 */
export async function POST(request: Request) {
  if (!isExotelWhatsAppConfigured()) {
    return NextResponse.json(
      {
        error:
          "Exotel WhatsApp is not configured. Set EXOTEL_SID, EXOTEL_API_KEY, and EXOTEL_API_TOKEN on the server.",
      },
      { status: 503 }
    );
  }

  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const lineResult = await getUserWhatsAppLine(supabase, user.id);
  if (!lineResult.ok) {
    return NextResponse.json({ error: lineResult.error }, { status: lineResult.status });
  }
  const businessLine = lineResult.data.line;

  const body = (await request.json().catch(() => null)) as {
    to?: string;
    text?: string;
    replyToId?: string;
  } | null;
  const to = body?.to?.trim() || "";
  const text = body?.text?.trim() || "";
  const replyToIdRaw = body?.replyToId?.trim() || "";

  if (!isValidE164(normalizePhone(to))) {
    return NextResponse.json(
      { error: "Provide recipient in E.164 format, e.g. +919876543210" },
      { status: 400 }
    );
  }
  if (!text) {
    return NextResponse.json({ error: "text (message body) is required" }, { status: 400 });
  }

  const peerNorm = peerForOutbound(to);
  let replyToId: string | null = null;
  if (replyToIdRaw) {
    const { data: ref, error: refErr } = await supabase
      .from("whatsapp_messages")
      .select("id, peer_e164, business_e164, deleted_at")
      .eq("id", replyToIdRaw)
      .maybeSingle();
    if (
      refErr ||
      !ref ||
      ref.deleted_at ||
      ref.peer_e164 !== peerNorm ||
      (ref.business_e164 && ref.business_e164 !== businessLine)
    ) {
      return NextResponse.json({ error: "Invalid reply reference for this chat" }, { status: 400 });
    }
    replyToId = ref.id as string;
  }

  try {
    const { sid } = await sendExotelWhatsAppText({
      fromE164: businessLine,
      toE164: normalizePhone(to),
      body: text,
    });

    const { error: logErr } = await supabase.from("whatsapp_messages").insert({
      user_id: user.id,
      direction: "outbound",
      peer_e164: peerNorm,
      business_e164: businessLine,
      from_addr: businessLine,
      to_addr: normalizePhone(to),
      body: text,
      message_sid: sid,
      num_media: 0,
      reply_to_id: replyToId,
      delivery_status: "sent",
    });
    if (logErr && !String(logErr.message).includes("does not exist")) {
      console.warn("[whatsapp/send] log insert:", logErr.message);
    }
    return NextResponse.json({ ok: true, messageSid: sid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send WhatsApp message";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

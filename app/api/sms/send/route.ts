import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTwilioClient, getTwilioFromNumber, isTwilioConfigured } from "@/lib/twilio";
import { peerForOutbound } from "@/lib/whatsapp-address";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isTwilioConfigured()) {
    return NextResponse.json(
      {
        error:
          "Twilio SMS is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER (E.164).",
      },
      { status: 503 },
    );
  }

  const from = getTwilioFromNumber();
  if (!from.startsWith("+")) {
    return NextResponse.json(
      { error: "TWILIO_PHONE_NUMBER must be E.164 (e.g. +15551234567)." },
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

  const body = (await request.json().catch(() => null)) as { to?: string; text?: string } | null;
  const to = body?.to?.trim() || "";
  const text = body?.text?.trim() || "";

  if (!to.startsWith("+") || to.length < 8) {
    return NextResponse.json({ error: "Provide recipient in E.164 format, e.g. +14155552671" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "text (message body) is required" }, { status: 400 });
  }
  if (text.length > 1600) {
    return NextResponse.json({ error: "Message body too long (max 1600 characters)" }, { status: 400 });
  }

  const client = getTwilioClient();
  if (!client) {
    return NextResponse.json({ error: "Twilio client unavailable" }, { status: 503 });
  }

  try {
    const msg = await client.messages.create({
      from,
      to,
      body: text,
    });
    const sid = msg.sid;
    const peerNorm = peerForOutbound(to);

    const { error: logErr } = await supabase.from("sms_messages").insert({
      user_id: user.id,
      direction: "outbound",
      peer_e164: peerNorm,
      from_addr: from,
      to_addr: to,
      body: text,
      message_sid: sid,
    });
    if (logErr && !String(logErr.message).includes("does not exist")) {
      console.warn("[sms/send] log insert:", logErr.message);
    }

    return NextResponse.json({ ok: true, messageSid: sid });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Failed to send SMS";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

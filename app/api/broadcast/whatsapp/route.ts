import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTwilioClient } from "@/lib/twilio";
import {
  getWhatsAppFromAddress,
  isWhatsAppSendConfigured,
  sendWhatsAppSessionMessage,
  toWhatsAppAddress,
} from "@/lib/whatsapp";
import { normalizeToE164 } from "@/lib/broadcast-phones";
import { peerForOutbound } from "@/lib/whatsapp-address";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_RECIPIENTS = 50;
const MS_BETWEEN_SENDS = 550;

type Body = {
  recipients: string[];
  text: string;
};

export async function POST(request: Request) {
  if (!isWhatsAppSendConfigured()) {
    return NextResponse.json(
      {
        error:
          "WhatsApp is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and sandbox or production WhatsApp sender.",
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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawList = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients = Array.from(
    new Set(
      rawList
        .map((r) => normalizeToE164(String(r)))
        .filter((r): r is string => r !== null),
    ),
  );

  const text = (body.text ?? "").trim();
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Add at least one valid phone in E.164 format (e.g. +14155552671)" }, { status: 400 });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS} per batch)` }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }

  const client = getTwilioClient();
  if (!client) {
    return NextResponse.json({ error: "Twilio client unavailable" }, { status: 503 });
  }

  const fromAddr = getWhatsAppFromAddress();
  const failed: { phone: string; error: string }[] = [];
  let sent = 0;

  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i];
    try {
      const { sid } = await sendWhatsAppSessionMessage(client, { toE164: to, body: text });
      if (fromAddr) {
        const { error: logErr } = await supabase.from("whatsapp_messages").insert({
          user_id: user.id,
          direction: "outbound",
          peer_e164: peerForOutbound(to),
          from_addr: fromAddr,
          to_addr: toWhatsAppAddress(to),
          body: text,
          message_sid: sid,
          num_media: 0,
        });
        if (logErr && !String(logErr.message).includes("does not exist")) {
          console.warn("[broadcast/whatsapp] log insert:", logErr.message);
        }
      }
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Send failed";
      failed.push({ phone: to, error: msg });
    }
    if (i < recipients.length - 1) {
      await new Promise((r) => setTimeout(r, MS_BETWEEN_SENDS));
    }
  }

  return NextResponse.json({ sent, failed });
}

import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { isExotelSmsConfigured, sendExotelSms } from "@/lib/exotel-sms";
import { getUserSmsLine } from "@/lib/sms-telephony";
import { normalizeToE164 } from "@/lib/broadcast-phones";
import { peerForOutbound } from "@/lib/whatsapp-address";
import { createServiceSupabase } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_RECIPIENTS = 50;
const MS_BETWEEN_SENDS = 550;
const MAX_BODY_CHARS = 2000;

type Body = {
  recipients: string[];
  text: string;
};

export async function POST(request: Request) {
  if (!isExotelSmsConfigured()) {
    return NextResponse.json(
      {
        error:
          "Exotel SMS is not configured. Set EXOTEL_SID, EXOTEL_API_KEY, and EXOTEL_API_TOKEN on the server.",
      },
      { status: 503 },
    );
  }

  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Broadcast goes out from the sender's own admin-assigned Exotel number.
  const lineResult = await getUserSmsLine(supabase, user.id);
  if (!lineResult.ok) {
    return NextResponse.json({ error: lineResult.error }, { status: lineResult.status });
  }
  const from = lineResult.line;

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
    return NextResponse.json({ error: "Add at least one valid phone with country code (e.g. +919876543210)" }, { status: 400 });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Too many recipients (max ${MAX_RECIPIENTS} per batch)` }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Message body is required" }, { status: 400 });
  }
  if (text.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: `Message too long (max ${MAX_BODY_CHARS} characters)` }, { status: 400 });
  }

  let svc: ReturnType<typeof createServiceSupabase> | null = null;
  try {
    svc = createServiceSupabase();
  } catch {
    svc = null;
  }

  const failed: { phone: string; error: string }[] = [];
  let sent = 0;

  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i];
    try {
      const result = await sendExotelSms({ from, to, body: text });
      const logRow = {
        user_id: user.id,
        direction: "outbound" as const,
        peer_e164: peerForOutbound(to),
        business_e164: from,
        from_addr: from,
        to_addr: to,
        body: text,
        message_sid: result.sid,
        delivery_status: result.status,
      };
      const { error: logErr } = svc
        ? await svc.from("sms_messages").insert(logRow)
        : await supabase.from("sms_messages").insert(logRow);
      if (logErr && !String(logErr.message).includes("does not exist")) {
        console.warn("[broadcast/sms] sms_messages log:", logErr.message);
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

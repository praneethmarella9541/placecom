import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { isExotelSmsConfigured, sendExotelSms } from "@/lib/exotel-sms";
import { getUserSmsLine } from "@/lib/sms-telephony";
import { peerForOutbound } from "@/lib/whatsapp-address";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isValidE164, normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

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

  // The "from" is the Exotel number the admin assigned this user under Team.
  const lineResult = await getUserSmsLine(supabase, user.id);
  if (!lineResult.ok) {
    return NextResponse.json({ error: lineResult.error }, { status: lineResult.status });
  }
  const from = lineResult.line;

  const body = (await request.json().catch(() => null)) as { to?: string; text?: string } | null;
  const toRaw = body?.to?.trim() || "";
  const text = body?.text?.trim() || "";
  const to = normalizePhone(toRaw);

  if (!isValidE164(to)) {
    return NextResponse.json(
      { error: "Provide recipient in E.164 format, e.g. +919876543210" },
      { status: 400 },
    );
  }
  if (!text) {
    return NextResponse.json({ error: "text (message body) is required" }, { status: 400 });
  }
  if (text.length > 2000) {
    return NextResponse.json({ error: "Message body too long (max 2000 characters)" }, { status: 400 });
  }

  try {
    const sent = await sendExotelSms({ from, to, body: text });
    const peerNorm = peerForOutbound(to);

    const logRow = {
      user_id: user.id,
      direction: "outbound" as const,
      peer_e164: peerNorm,
      business_e164: from,
      from_addr: from,
      to_addr: to,
      body: text,
      message_sid: sent.sid,
      delivery_status: sent.status,
    };

    // Service role for the insert so the outbound row is written even if the
    // user's RLS context is unusual (mirrors whatsapp/send).
    let logErr: { message: string; code?: string } | null = null;
    try {
      const svc = createServiceSupabase();
      const { error } = await svc.from("sms_messages").insert(logRow);
      logErr = error;
    } catch {
      const { error } = await supabase.from("sms_messages").insert(logRow);
      logErr = error;
    }

    if (logErr) {
      const dup = (logErr as { code?: string }).code === "23505";
      if (!dup && !String(logErr.message).includes("does not exist")) {
        console.warn("[sms/send] log insert:", logErr.message);
      }
    }

    return NextResponse.json({ ok: true, messageSid: sent.sid });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : "Failed to send SMS";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

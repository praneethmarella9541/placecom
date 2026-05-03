import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTwilioClient } from "@/lib/twilio";

export const runtime = "nodejs";

const RE_SID = /^RE[0-9a-f]{32}$/i;

export async function GET(
  _request: Request,
  context: { params: { recordingSid: string } }
) {
  const recordingSid = context.params.recordingSid?.trim() || "";
  if (!RE_SID.test(recordingSid)) {
    return NextResponse.json({ error: "Invalid recording" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: row, error } = await supabase
    .from("call_logs")
    .select("id")
    .eq("user_id", user.id)
    .eq("recording_sid", recordingSid)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const client = getTwilioClient();
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!client || !accountSid || !token) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const mp3Url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`;
  const basic = Buffer.from(`${accountSid}:${token}`).toString("base64");

  const upstream = await fetch(mp3Url, {
    headers: { Authorization: `Basic ${basic}` },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Recording unavailable" }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

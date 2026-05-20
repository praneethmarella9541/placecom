import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthedRequest } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: { recordingSid: string } }
) {
  const authed = await getAuthedRequest(request);
  if (!authed) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const recordingSid = context.params.recordingSid?.trim() || "";
  if (!recordingSid) {
    return NextResponse.json({ error: "Missing recording ID" }, { status: 400 });
  }

  const sid      = process.env.EXOTEL_SID?.trim();
  const apiKey   = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();

  if (!sid || !apiKey || !apiToken) {
    return NextResponse.json({ error: "Exotel credentials not configured" }, { status: 500 });
  }

  // Verify this recording belongs to the requesting user
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: row } = await svc
    .from("call_logs")
    .select("id")
    .eq("user_id", authed.user.id)
    .eq("recording_sid", recordingSid)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  // Exotel recording URL: GET with Basic apiKey:apiToken auth
  const recordingUrl = `https://api.exotel.com/v1/Accounts/${sid}/Recordings/${recordingSid}.mp3`;
  const basic = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");

  const upstream = await fetch(recordingUrl, {
    headers: { Authorization: `Basic ${basic}` },
  });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Recording unavailable (${upstream.status})` }, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

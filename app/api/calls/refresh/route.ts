import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthedRequest } from "@/lib/api-auth";
import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";
import { normalizePhone, phoneMatches } from "@/lib/phone";
import { deriveCallDirection, resolveCallStatus } from "@/lib/call-status";

export const runtime = "nodejs";

type ExotelCall = {
  Status?: string;
  Duration?: string | number;
  ConversationDuration?: string | number;
  RecordingDuration?: string | number;
  StartTime?: string;
  EndTime?: string;
  RecordingUrl?: string;
};

async function fetchExotelCall(callSid: string): Promise<ExotelCall | null> {
  const sid      = process.env.EXOTEL_SID?.trim();
  const apiKey   = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();
  if (!sid || !apiKey || !apiToken) throw new Error("Exotel not configured");

  const basic = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
  const res = await fetch(
    `https://api.exotel.com/v1/Accounts/${sid}/Calls/${callSid}.json`,
    { headers: { Authorization: `Basic ${basic}` } }
  );
  if (!res.ok) throw new Error(`Exotel call lookup failed (${res.status})`);
  const json = await res.json();
  return json?.Call ?? json?.TwilioResponse?.Call ?? null;
}

export async function POST(request: Request) {
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  const id = body?.id?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: row } = await svc
    .from("call_logs")
    .select("id, call_sid, status, from_number")
    .eq("id", id)
    .eq("user_id", authed.user.id)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!row.call_sid || row.call_sid.startsWith("pending_") || row.call_sid.startsWith("exotel_")) {
    return NextResponse.json({ ok: false, reason: "No Exotel CallSid yet" });
  }

  let call: ExotelCall | null;
  try {
    call = await fetchExotelCall(row.call_sid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch call";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (!call) return NextResponse.json({ ok: false, reason: "Call not found in Exotel" });

  const status = (call.Status ?? "").toLowerCase();
  const virtuals = listConfiguredExotelNumbers().map((v) => normalizePhone(v));
  const direction = deriveCallDirection(row.from_number, virtuals, phoneMatches);
  const mapped = resolveCallStatus(
    {
      status: call.Status,
      duration: call.Duration,
      conversationDuration: call.ConversationDuration,
      recordingDuration: call.RecordingDuration,
      hasRecording: !!call.RecordingUrl,
    },
    direction
  );

  const updates: Record<string, unknown> = {
    status: mapped,
    updated_at: new Date().toISOString(),
  };
  if (call.RecordingDuration != null) {
    updates.recording_duration_seconds = parseInt(String(call.RecordingDuration), 10) || null;
  }
  if (call.Duration != null) updates.duration_seconds = parseInt(String(call.Duration), 10) || null;
  if (call.StartTime) {
    try { updates.started_at = new Date(call.StartTime).toISOString(); } catch {}
  }
  if (call.EndTime && call.EndTime !== "1970-01-01 05:30:00") {
    try { updates.ended_at = new Date(call.EndTime).toISOString(); } catch {}
  }
  if (call.RecordingUrl) updates.recording_sid = call.RecordingUrl;

  const { error: upErr } = await svc
    .from("call_logs")
    .update(updates)
    .eq("id", row.id);

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    exotelStatus: status,
    mappedStatus: mapped,
    hasRecording: !!call.RecordingUrl,
    duration: call.Duration,
  });
}

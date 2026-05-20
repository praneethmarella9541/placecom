import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Terminal CallType values Exotel sends on end-of-call hit
const TERMINAL_CALL_TYPES = new Set([
  "completed", "incomplete", "client-hangup", "voicemail", "call-attempt",
]);

const DIAL_STATUS_MAP: Record<string, string> = {
  completed:  "completed",
  busy:       "busy",
  "no-answer":"no-answer",
  failed:     "failed",
  canceled:   "failed",
};

async function fetchRecordingUrl(callSid: string): Promise<string | null> {
  const sid      = process.env.EXOTEL_SID?.trim();
  const apiKey   = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();
  if (!sid || !apiKey || !apiToken) return null;

  // Exotel recordings API — may not be ready immediately; caller should retry
  const url = `https://api.exotel.com/v1/Accounts/${sid}/Calls/${callSid}/Recordings.json`;
  const basic = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
    if (!res.ok) return null;
    const json = await res.json();
    // Response: { TwilioResponse: { RecordingList: { Recording: [...] | {} } } }
    const list = json?.TwilioResponse?.RecordingList?.Recording;
    const recordings: Array<Record<string, unknown>> = Array.isArray(list) ? list : list ? [list] : [];
    if (recordings.length === 0) return null;
    // Return the first recording's URI (an S3 URL or API path)
    return recordings[0]?.Uri ?? recordings[0]?.RecordingUrl ?? null;
  } catch {
    return null;
  }
}

async function handleEndOfCall(params: URLSearchParams | FormData, callSid: string) {
  const callType      = params.get("CallType")?.toString() ?? "";
  const dialStatus    = params.get("DialCallStatus")?.toString() ?? "";
  const endTime       = params.get("EndTime")?.toString() ?? "";
  const startTime     = params.get("StartTime")?.toString() ?? "";
  const dialDuration  = params.get("DialCallDuration")?.toString() ?? "";
  const recordingUrl  = params.get("RecordingUrl")?.toString() ?? ""; // voicemail only

  // Map to internal status
  let mappedStatus = DIAL_STATUS_MAP[dialStatus.toLowerCase()] ?? "";
  if (!mappedStatus) {
    mappedStatus = callType === "completed" ? "completed"
      : callType === "incomplete" ? "no-answer"
      : callType === "client-hangup" ? "completed"
      : callType === "voicemail" ? "completed"
      : "failed";
  }

  const updates: Record<string, unknown> = {
    status: mappedStatus,
    updated_at: new Date().toISOString(),
  };

  if (dialDuration) updates.duration_seconds = parseInt(dialDuration, 10) || null;
  if (startTime) {
    try { updates.started_at = new Date(startTime).toISOString(); } catch {}
  }
  if (endTime && endTime !== "1970-01-01 05:30:00") {
    try { updates.ended_at = new Date(endTime).toISOString(); } catch {}
  }

  // RecordingUrl present for voicemail; for regular calls fetch from Recordings API
  const storedUrl = recordingUrl || (await fetchRecordingUrl(callSid));
  if (storedUrl) updates.recording_sid = storedUrl;

  console.log("[calls/connect] end-of-call | sid:", callSid, "| callType:", callType,
    "| dialStatus:", dialStatus, "| mapped:", mappedStatus, "| recording:", storedUrl ?? "none");

  await supabaseAdmin
    .from("call_logs")
    .update(updates)
    .eq("call_sid", callSid);
}

async function resolveDestination(params: URLSearchParams | FormData, callerPhone: string, exotelCallSid: string) {
  const dtmfDigits = params.get("digits")?.toString() ?? params.get("Digits")?.toString() ?? "";

  // 3-minute window — recent pending row
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();

  const { data: pending } = await supabaseAdmin
    .from("call_logs")
    .select("id, to_number")
    .eq("status", "pending")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let destination = pending?.to_number ?? "";

  if (!destination && dtmfDigits) {
    destination = dtmfDigits.startsWith("+") ? dtmfDigits : `+91${dtmfDigits}`;
  }

  console.log("[calls/connect] caller:", callerPhone, "| destination:", destination, "| pending row:", pending?.id ?? "none");

  // Mark in-progress
  if (destination && pending) {
    await supabaseAdmin
      .from("call_logs")
      .update({
        call_sid: exotelCallSid || `exotel_${Date.now()}`,
        agent_number: callerPhone,
        status: "in-progress",
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", pending.id);
  }

  return destination;
}

function buildResponse(destination: string) {
  if (!destination) {
    return NextResponse.json(
      { destination: { numbers: [] } },
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const virtualNumber = process.env.EXOTEL_VIRTUAL_NUMBER ?? "+919513886363";

  return NextResponse.json(
    {
      destination: { numbers: [destination] },
      outgoing_phone_number: virtualNumber,
      record: true,
      recording_channels: "dual",
      max_ringing_duration: 45,
      max_conversation_duration: 3600,
    },
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// Exotel Programmable Connect uses GET with query params
export async function GET(request: Request) {
  const url = new URL(request.url);
  const callerPhone   = url.searchParams.get("CallFrom") ?? url.searchParams.get("From") ?? "";
  const exotelCallSid = url.searchParams.get("CallSid") ?? "";
  const callType      = url.searchParams.get("CallType") ?? "";

  // Health check (no Exotel params)
  if (!callerPhone && !exotelCallSid) {
    return NextResponse.json({ status: "Exotel connect webhook is live" });
  }

  // End-of-call hit — CallType is present and is a terminal value
  if (exotelCallSid && TERMINAL_CALL_TYPES.has(callType)) {
    await handleEndOfCall(url.searchParams, exotelCallSid);
    return NextResponse.json({ ok: true });
  }

  const destination = await resolveDestination(url.searchParams, callerPhone, exotelCallSid);
  return buildResponse(destination);
}

// Some Exotel configs send POST
export async function POST(request: Request) {
  let params: URLSearchParams;
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const json = await request.json().catch(() => ({}));
    params = new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v)]));
  } else if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await request.text());
  } else {
    const form = await request.formData();
    params = new URLSearchParams();
    form.forEach((v, k) => params.set(k, v.toString()));
  }

  const callerPhone   = params.get("CallFrom") ?? params.get("From") ?? "";
  const exotelCallSid = params.get("CallSid") ?? "";
  const callType      = params.get("CallType") ?? "";

  if (exotelCallSid && TERMINAL_CALL_TYPES.has(callType)) {
    await handleEndOfCall(params, exotelCallSid);
    return NextResponse.json({ ok: true });
  }

  const destination = await resolveDestination(params, callerPhone, exotelCallSid);
  return buildResponse(destination);
}

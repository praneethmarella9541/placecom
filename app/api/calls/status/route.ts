import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Exotel posts call status when the call ends.
// Configure this URL in Exotel dashboard → App → Status Callback URL:
//   https://www.rideasy.co.in/api/calls/status
export async function POST(request: Request) {
  let params: URLSearchParams;
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const json = await request.json().catch(() => ({}));
    params = new URLSearchParams(
      Object.entries(json).map(([k, v]) => [k, String(v)])
    );
  } else {
    const text = await request.text();
    params = new URLSearchParams(text);
  }

  const callSid      = params.get("CallSid") ?? params.get("call_sid") ?? "";
  const status       = params.get("Status") ?? params.get("status") ?? "";
  const recordingUrl = params.get("RecordingUrl") ?? params.get("recording_url") ?? "";
  const recordingDuration = params.get("RecordingDuration") ?? params.get("recording_duration") ?? "";
  const duration     = params.get("Duration") ?? params.get("duration") ?? "";
  const startTime    = params.get("StartTime") ?? params.get("start_time") ?? "";
  const endTime      = params.get("EndTime") ?? params.get("end_time") ?? "";

  console.log("[calls/status] callSid:", callSid, "| status:", status, "| recordingUrl:", recordingUrl);

  if (!callSid) {
    return NextResponse.json({ error: "Missing CallSid" }, { status: 400 });
  }

  // Map Exotel statuses to our internal values
  const statusMap: Record<string, string> = {
    completed:    "completed",
    "no-answer":  "no-answer",
    "no answer":  "no-answer",
    busy:         "busy",
    failed:       "failed",
    canceled:     "failed",
    cancelled:    "failed",
  };
  const mappedStatus = statusMap[status.toLowerCase()] ?? status.toLowerCase();

  // Extract recording SID from the recording URL
  // Exotel URL: https://api.exotel.com/v1/Accounts/{sid}/Recordings/{recordingSid}
  let recordingSid: string | null = null;
  if (recordingUrl) {
    const match = recordingUrl.match(/Recordings\/([^/?#.]+)/i);
    if (match) recordingSid = match[1];
  }

  const updates: Record<string, unknown> = {
    status: mappedStatus,
    updated_at: new Date().toISOString(),
  };

  if (duration) updates.duration_seconds = parseInt(duration, 10) || null;
  if (recordingDuration) updates.recording_duration_seconds = parseInt(recordingDuration, 10) || null;
  if (recordingSid) updates.recording_sid = recordingSid;
  if (startTime) updates.started_at = new Date(startTime).toISOString();
  if (endTime) updates.ended_at = new Date(endTime).toISOString();

  const { error } = await supabaseAdmin
    .from("call_logs")
    .update(updates)
    .eq("call_sid", callSid);

  if (error) {
    console.error("[calls/status] update failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// Exotel may also GET the status URL as a health check
export async function GET() {
  return NextResponse.json({ status: "Exotel status webhook is live" });
}

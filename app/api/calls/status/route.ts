import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";
import { normalizePhone, phoneMatches } from "@/lib/phone";
import { deriveCallDirection, resolveCallStatus } from "@/lib/call-status";
import { fetchExotelCallPatch } from "@/lib/exotel-call-refresh";

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
  const dialDuration = params.get("DialCallDuration") ?? params.get("dial_call_duration") ?? "";
  const conversationDuration =
    params.get("ConversationDuration") ?? params.get("conversation_duration") ?? dialDuration;
  // Per-leg dial status, when Exotel includes it — the strongest answered signal.
  const legStatus =
    params.get("DialCallStatus") ?? params.get("Legs[0][Status]") ?? params.get("leg_status") ?? "";
  const startTime    = params.get("StartTime") ?? params.get("start_time") ?? "";
  const endTime      = params.get("EndTime") ?? params.get("end_time") ?? "";

  // Exotel also sends PreSignedRecordingUrl (5-min presigned S3 URL, available since Oct 2024)
  // We prefer the base RecordingUrl (permanent S3 path) and fetch it ourselves with API credentials.
  // RecordingUrl format: https://s3-ap-southeast-1.amazonaws.com/exotelrecordings/{sid}/{CallSid}.mp3
  const preSignedUrl = params.get("PreSignedRecordingUrl") ?? "";

  console.log("[calls/status] callSid:", callSid, "| status:", status, "| recordingUrl:", recordingUrl, "| preSignedUrl:", preSignedUrl ? "present" : "none");

  if (!callSid) {
    return NextResponse.json({ error: "Missing CallSid" }, { status: 400 });
  }

  // Store the S3 recording URL directly in recording_sid column.
  // The recording proxy fetches it using Exotel API credentials.
  // Fall back to presigned URL if base URL is missing (presigned expires in 5 min, but better than nothing).
  const storedRecordingUrl = recordingUrl || preSignedUrl || null;

  // Determine direction from the stored row so an unanswered call is labelled
  // correctly (missed for incoming, no-answer for outbound).
  const { data: existing } = await supabaseAdmin
    .from("call_logs")
    .select("from_number")
    .eq("call_sid", callSid)
    .maybeSingle();
  const virtuals = listConfiguredExotelNumbers().map((v) => normalizePhone(v));
  const direction = deriveCallDirection(existing?.from_number, virtuals, phoneMatches);

  const mappedStatus = resolveCallStatus(
    {
      status,
      duration,
      conversationDuration,
      recordingDuration,
      hasRecording: !!storedRecordingUrl,
      legStatus,
    },
    direction
  );

  const updates: Record<string, unknown> = {
    status: mappedStatus,
    updated_at: new Date().toISOString(),
  };

  if (duration) updates.duration_seconds = parseInt(duration, 10) || null;
  const talkFromWebhook =
    (conversationDuration ? parseInt(conversationDuration, 10) : 0) ||
    (recordingDuration ? parseInt(recordingDuration, 10) : 0) ||
    (dialDuration ? parseInt(dialDuration, 10) : 0);
  if (conversationDuration || dialDuration) {
    updates.conversation_duration_seconds = parseInt(conversationDuration || dialDuration, 10) || null;
  }
  if (recordingDuration) {
    updates.recording_duration_seconds = parseInt(recordingDuration, 10) || null;
  } else if (talkFromWebhook > 0 && storedRecordingUrl) {
    updates.recording_duration_seconds = talkFromWebhook;
  }
  if (storedRecordingUrl) updates.recording_sid = storedRecordingUrl;
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

  // If we have a recording but no talk time yet, pull full call details from Exotel.
  if (storedRecordingUrl && talkFromWebhook <= 0) {
    const patch = await fetchExotelCallPatch(callSid, existing?.from_number);
    if (patch) {
      await supabaseAdmin.from("call_logs").update(patch).eq("call_sid", callSid);
    }
  }

  return NextResponse.json({ ok: true });
}

// Exotel may also GET the status URL as a health check
export async function GET() {
  return NextResponse.json({ status: "Exotel status webhook is live" });
}

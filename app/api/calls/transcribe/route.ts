import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { transcribeCallRecording } from "@/lib/call-transcription";
import { getTwilioClient } from "@/lib/twilio";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { callLogId?: string } | null;
  const callLogId = body?.callLogId?.trim();
  if (!callLogId) {
    return NextResponse.json({ error: "callLogId is required" }, { status: 400 });
  }

  const { data: row, error: selErr } = await supabase
    .from("call_logs")
    .select("id, recording_sid, transcript, transcript_segments")
    .eq("id", callLogId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Call log not found" }, { status: 404 });
  }
  if (!row.recording_sid) {
    return NextResponse.json({ error: "No recording for this call yet" }, { status: 400 });
  }
  if (row.transcript !== null) {
    return NextResponse.json({
      ok: true,
      transcript: row.transcript,
      transcript_segments: row.transcript_segments,
      skipped: true,
    });
  }

  const twilioClient = getTwilioClient();
  if (!twilioClient) {
    return NextResponse.json({ error: "Twilio is not configured" }, { status: 503 });
  }

  try {
    const { segments, transcriptPlain, source } = await transcribeCallRecording(twilioClient, row.recording_sid);
    if (!transcriptPlain.trim()) {
      return NextResponse.json({ error: "Transcription produced no text for this recording." }, { status: 500 });
    }
    const { data: updated, error: upErr } = await supabase
      .from("call_logs")
      .update({
        transcript: transcriptPlain,
        transcript_segments: segments,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("user_id", user.id)
      .select("id, transcript, transcript_segments");

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
    if (!updated?.length) {
      return NextResponse.json(
        {
          error:
            "Could not save transcript. Apply Supabase migrations 0010 and 0011 (transcript + transcript_segments), or verify your account can update call_logs.",
        },
        { status: 500 }
      );
    }

    const saved = updated[0].transcript != null ? String(updated[0].transcript) : transcriptPlain;
    const savedSegs = updated[0].transcript_segments;
    return NextResponse.json({
      ok: true,
      transcript: saved,
      transcript_segments: savedSegs,
      transcription_source: source,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Transcription failed";
    const clientError =
      msg.includes("too long") ||
      msg.includes("zero duration") ||
      msg.includes("Wait for processing") ||
      msg.includes("Invalid recording SID");
    return NextResponse.json({ error: msg }, { status: clientError ? 400 : 500 });
  }
}

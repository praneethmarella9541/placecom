import { NextResponse } from "next/server";
import OpenAI, { toFile } from "openai";
import { getAuthedRequest } from "@/lib/api-auth";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 180;

async function fetchExotelRecording(s3Url: string): Promise<Buffer> {
  const apiKey   = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();
  if (!apiKey || !apiToken) throw new Error("Exotel credentials not configured");

  // recording_sid stores the full S3 URL; fetch with Basic auth
  const basic = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
  const res = await fetch(s3Url, { headers: { Authorization: `Basic ${basic}` } });
  if (!res.ok) throw new Error(`Could not fetch recording (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function POST(request: Request) {
  const authed = await getAuthedRequest(request);
  if (!authed) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { callLogId?: string } | null;
  const callLogId = body?.callLogId?.trim();
  if (!callLogId) {
    return NextResponse.json({ error: "callLogId is required" }, { status: 400 });
  }

  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: row, error: selErr } = await svc
    .from("call_logs")
    .select("id, recording_sid, transcript, transcript_segments")
    .eq("id", callLogId)
    .eq("user_id", authed.user.id)
    .maybeSingle();

  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Call log not found" }, { status: 404 });
  if (!row.recording_sid) return NextResponse.json({ error: "No recording for this call yet" }, { status: 400 });

  if (row.transcript !== null) {
    return NextResponse.json({
      ok: true,
      transcript: row.transcript,
      transcript_segments: row.transcript_segments,
      skipped: true,
    });
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiKey) return NextResponse.json({ error: "OpenAI not configured" }, { status: 503 });

  let audioBuf: Buffer;
  try {
    audioBuf = await fetchExotelRecording(row.recording_sid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to fetch recording";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const openai = new OpenAI({ apiKey: openaiKey });
  const audioFile = await toFile(audioBuf, `${row.recording_sid}.mp3`, { type: "audio/mpeg" });

  let transcription: OpenAI.Audio.Transcription;
  try {
    transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Transcription failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const plain = transcription.text?.trim() ?? "";
  if (!plain) return NextResponse.json({ error: "Transcription produced no text" }, { status: 500 });

  type WhisperSegment = { text?: string; start?: number; end?: number };
  const whisperSegments = (transcription as unknown as { segments?: WhisperSegment[] }).segments ?? [];
  const segments = whisperSegments.map((s) => ({
    speaker: "Speaker",
    text: s.text?.trim() ?? "",
    start: s.start,
    end: s.end,
  }));

  const { data: updated, error: upErr } = await svc
    .from("call_logs")
    .update({ transcript: plain, transcript_segments: segments, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("user_id", authed.user.id)
    .select("id, transcript, transcript_segments")
    .single();

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    transcript: updated.transcript,
    transcript_segments: updated.transcript_segments,
  });
}

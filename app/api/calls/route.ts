import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTwilioClient } from "@/lib/twilio";

export const runtime = "nodejs";

const FINAL_STATUSES = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);

function validPhone(input: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(input.replace(/\s+/g, ""));
}

async function getUserOr401() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null as null };
  return { supabase, user };
}

async function firstUsableRecording(client: NonNullable<ReturnType<typeof getTwilioClient>>, callSid: string) {
  try {
    const nested = await client.calls(callSid).recordings.list({ limit: 20 });
    const fromNested =
      nested.find((r) => r.status === "completed") ||
      nested.find((r) => r.status === "processing") ||
      nested[0];
    if (fromNested) return fromNested;
  } catch {
    // fall through to account-level list
  }
  try {
    const list = await client.recordings.list({ callSid, limit: 20 });
    return list.find((r) => r.status === "completed") || list.find((r) => r.status === "processing") || list[0] || null;
  } catch {
    return null;
  }
}

function shouldAttemptRecordingSync(status: string): boolean {
  const s = String(status || "").toLowerCase();
  if (s === "queued" || s === "initiated") return false;
  return true;
}

async function syncRecordingsFromTwilio(
  client: NonNullable<ReturnType<typeof getTwilioClient>>,
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string,
  logs: Array<{ id: string; call_sid: string; recording_sid: string | null; status: string }>
): Promise<boolean> {
  const todo = logs.filter((l) => !l.recording_sid && shouldAttemptRecordingSync(String(l.status || ""))).slice(0, 10);

  let wrote = false;
  for (const log of todo) {
    let rec: Awaited<ReturnType<typeof firstUsableRecording>> = await firstUsableRecording(client, log.call_sid);
    if (!rec) {
      try {
        const children = await client.calls.list({ parentCallSid: log.call_sid, limit: 10 });
        for (const c of children) {
          rec = await firstUsableRecording(client, c.sid);
          if (rec) break;
        }
      } catch {
        continue;
      }
    }
    if (!rec?.sid) continue;
    const dur = rec.duration ? Number.parseInt(String(rec.duration), 10) : null;
    const { error: upErr } = await supabase
      .from("call_logs")
      .update({
        recording_sid: rec.sid,
        recording_duration_seconds: Number.isFinite(dur) ? dur : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", log.id)
      .eq("user_id", userId);
    if (!upErr) wrote = true;
  }
  return wrote;
}

async function syncCallStatuses(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string
) {
  const client = getTwilioClient();
  if (!client) return;

  const { data: pending } = await supabase
    .from("call_logs")
    .select("id, call_sid, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(12);

  for (const row of pending || []) {
    if (FINAL_STATUSES.has(String(row.status || ""))) continue;
    try {
      const remote = await client.calls(String(row.call_sid)).fetch();
      const duration = remote.duration ? Number(remote.duration) : null;
      await supabase
        .from("call_logs")
        .update({
          status: remote.status,
          duration_seconds: Number.isFinite(duration) ? duration : null,
          started_at: remote.startTime ? new Date(remote.startTime).toISOString() : null,
          ended_at: remote.endTime ? new Date(remote.endTime).toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
        .eq("user_id", userId);
    } catch {
      // Skip individual sync errors and return best effort logs.
    }
  }
}

export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const url = new URL(request.url);
  const syncRecordings = url.searchParams.get("syncRecordings") === "1";

  await syncCallStatuses(supabase, user.id);

  const { data, error } = await supabase
    .from("call_logs")
    .select(
      "id, call_sid, to_number, from_number, agent_number, company_name, notes, status, duration_seconds, started_at, ended_at, created_at, recording_sid, recording_duration_seconds, transcript, transcript_segments"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const twilioClient = getTwilioClient();
  if (syncRecordings && twilioClient && data?.length) {
    const wrote = await syncRecordingsFromTwilio(twilioClient, supabase, user.id, data);
    if (wrote) {
      const { data: refreshed, error: err2 } = await supabase
        .from("call_logs")
        .select(
          "id, call_sid, to_number, from_number, agent_number, company_name, notes, status, duration_seconds, started_at, ended_at, created_at, recording_sid, recording_duration_seconds, transcript, transcript_segments"
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!err2 && refreshed) {
        return NextResponse.json({ logs: refreshed });
      }
    }
  }

  return NextResponse.json({ logs: data || [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { to?: string } | null;
  const to = body?.to?.trim() || "";

  if (!validPhone(to)) {
    return NextResponse.json(
      { error: "Provide a valid phone number with country code, e.g. +919876543210." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("call_logs")
    .insert({
      user_id: user.id,
      call_sid: `pending_${Date.now()}`,
      to_number: to,
      from_number: process.env.EXOTEL_VIRTUAL_NUMBER ?? "",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

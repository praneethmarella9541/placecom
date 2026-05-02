import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTwilioClient, getTwilioFromNumber, isTwilioConfigured } from "@/lib/twilio";

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
    .limit(30);

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

export async function GET() {
  const { supabase, user } = await getUserOr401();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  await syncCallStatuses(supabase, user.id);

  const { data, error } = await supabase
    .from("call_logs")
    .select(
      "id, call_sid, to_number, from_number, agent_number, company_name, notes, status, duration_seconds, started_at, ended_at, created_at"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data || [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  if (!isTwilioConfigured()) {
    return NextResponse.json(
      {
        error:
          "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.",
      },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        to?: string;
        agentPhone?: string;
        companyName?: string;
        notes?: string;
      }
    | null;

  const to = body?.to?.trim() || "";
  const agentPhone = body?.agentPhone?.trim() || "";
  const companyName = body?.companyName?.trim() || "";
  const notes = body?.notes?.trim() || "";

  if (!validPhone(to) || !validPhone(agentPhone)) {
    return NextResponse.json(
      { error: "Provide valid E.164 phone numbers with +country code (e.g. +14155552671)." },
      { status: 400 }
    );
  }

  const client = getTwilioClient();
  const fromNumber = getTwilioFromNumber();
  if (!client || !fromNumber) {
    return NextResponse.json({ error: "Twilio client not initialized." }, { status: 500 });
  }

  try {
    // Click-to-call bridge:
    // 1) Twilio first calls the agent.
    // 2) After the agent answers, Twilio dials the recruiter and bridges audio.
    const bridgeTwiml = `<Response><Say voice="alice">Connecting your placement call now.</Say><Dial callerId="${fromNumber}"><Number>${to}</Number></Dial></Response>`;
    const bridgedCall = await client.calls.create({
      to: agentPhone,
      from: fromNumber,
      twiml: bridgeTwiml,
    });

    const { error } = await supabase.from("call_logs").insert({
      user_id: user.id,
      call_sid: bridgedCall.sid,
      to_number: to,
      from_number: fromNumber,
      agent_number: agentPhone,
      company_name: companyName || null,
      notes: [notes, `bridge_to:${to}`]
        .filter(Boolean)
        .join(" | "),
      status: bridgedCall.status || "queued",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);

    return NextResponse.json(
      {
        ok: true,
        call: {
          sid: bridgedCall.sid,
          status: bridgedCall.status,
        },
      },
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to start call";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

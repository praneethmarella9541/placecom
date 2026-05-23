import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function validPhone(input: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(input.replace(/\s+/g, ""));
}

const DIAL_STATUS_MAP: Record<string, string> = {
  completed:   "completed",
  busy:        "busy",
  "no-answer": "no-answer",
  failed:      "failed",
  canceled:    "failed",
  cancelled:   "failed",
};

// Fetch one call's details from Exotel and persist to DB. Returns the updated row patch (or null if not terminal yet).
async function refreshFromExotel(callSid: string): Promise<Record<string, unknown> | null> {
  const sid      = process.env.EXOTEL_SID?.trim();
  const apiKey   = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();
  if (!sid || !apiKey || !apiToken) return null;
  if (!callSid || callSid.startsWith("pending_") || callSid.startsWith("exotel_")) return null;

  const basic = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");

  try {
    const detailsRes = await fetch(
      `https://api.exotel.com/v1/Accounts/${sid}/Calls/${callSid}.json`,
      { headers: { Authorization: `Basic ${basic}` } }
    );
    if (!detailsRes.ok) return null;
    const json = await detailsRes.json();
    const call = json?.Call ?? json?.TwilioResponse?.Call ?? null;
    if (!call) return null;

    const status = (call.Status ?? "").toLowerCase();
    const mapped = DIAL_STATUS_MAP[status] ?? status;
    // Only persist if call has finished
    if (!["completed", "busy", "no-answer", "failed"].includes(mapped)) return null;

    const updates: Record<string, unknown> = {
      status: mapped,
      updated_at: new Date().toISOString(),
    };
    if (call.Duration) updates.duration_seconds = parseInt(call.Duration, 10) || null;
    if (call.StartTime) {
      try { updates.started_at = new Date(call.StartTime).toISOString(); } catch {}
    }
    if (call.EndTime && call.EndTime !== "1970-01-01 05:30:00") {
      try { updates.ended_at = new Date(call.EndTime).toISOString(); } catch {}
    }
    if (call.RecordingUrl) updates.recording_sid = call.RecordingUrl;

    return updates;
  } catch (e) {
    console.error("[calls] refreshFromExotel failed:", (e as Error).message);
    return null;
  }
}

async function getUserOr401(request?: Request) {
  // Bearer token auth — used by the mobile app
  const authHeader = request?.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) {
      const authedSupabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
      return { supabase: authedSupabase, user };
    }
    console.error("[auth] Bearer token rejected:", error?.message);
  }

  // Cookie-based auth — used by the web app
  const supabase = createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { supabase, user: null as null };
  return { supabase, user };
}

export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { data, error } = await supabase
    .from("call_logs")
    .select(
      "id, call_sid, to_number, from_number, agent_number, company_name, notes, status, duration_seconds, started_at, ended_at, created_at, recording_sid, recording_duration_seconds, transcript, transcript_segments"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Auto-refresh any in-progress calls (the connect end-of-call hit may not fire reliably)
  const stuck = rows.filter((r) => r.status === "in-progress" && r.call_sid);
  if (stuck.length > 0) {
    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await Promise.all(
      stuck.map(async (row) => {
        const patch = await refreshFromExotel(row.call_sid);
        if (!patch) return;
        await svc.from("call_logs").update(patch).eq("id", row.id);
        Object.assign(row, patch);
      })
    );
  }

  // Derive direction + peer (the "other party" number, never our own).
  // Incoming: from_number = external caller, to_number = our agent.
  // Outbound: from_number = our virtual number, to_number = destination.
  const virtualNumber = (process.env.EXOTEL_VIRTUAL_NUMBER ?? "").trim();
  const incomingAgent = (process.env.INCOMING_AGENT_NUMBER ?? "").trim();
  const norm = (s: string | null | undefined) =>
    (s ?? "").replace(/[\s\-().]/g, "").replace(/^0/, "").replace(/^\+?91/, "").replace(/^\+/, "");
  const virtualN = norm(virtualNumber);
  const agentN = norm(incomingAgent);

  const enriched = rows.map((r) => {
    const fromN = norm(r.from_number);
    const toN = norm(r.to_number);
    let direction: "incoming" | "outbound" = "outbound";
    if (virtualN && fromN === virtualN) {
      direction = "outbound";
    } else if (agentN && toN === agentN && fromN && fromN !== virtualN) {
      direction = "incoming";
    } else if (fromN && fromN !== virtualN && fromN !== agentN) {
      // Fallback: if from_number is some external party, treat as incoming
      direction = "incoming";
    }
    const peer_number = direction === "incoming" ? r.from_number : r.to_number;
    return { ...r, direction, peer_number };
  });

  return NextResponse.json({ logs: enriched });
}

export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    to?: string;
    agentPhone?: string;
  } | null;
  const to = body?.to?.trim() || "";
  const agentPhone = body?.agentPhone?.trim() || "";

  if (!validPhone(to)) {
    return NextResponse.json(
      { error: "Provide a valid phone number with country code, e.g. +919876543210." },
      { status: 400 }
    );
  }
  // agent_number is also validated when present, so the webhook can match precisely
  if (agentPhone && !validPhone(agentPhone)) {
    return NextResponse.json(
      { error: "Agent phone must include country code, e.g. +918056101540." },
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
      // agent_number holds the dialing user's phone so the Exotel connect
      // webhook can match the right pending row when multiple users (or
      // multiple attempts) are in flight.
      agent_number: agentPhone,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

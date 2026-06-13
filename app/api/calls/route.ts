import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";
import { isValidE164, normalizePhone, phoneMatches } from "@/lib/phone";
import { fetchExotelCallPatch } from "@/lib/exotel-call-refresh";
import { rowNeedsTalkDurationBackfill } from "@/lib/call-talk-seconds";

export const runtime = "nodejs";

// Fetch one call's details from Exotel and persist to DB. Returns the updated row patch (or null if not terminal yet).
async function refreshFromExotel(
  callSid: string,
  fromNumber?: string | null
): Promise<Record<string, unknown> | null> {
  return fetchExotelCallPatch(callSid, fromNumber);
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

  const { data: telephony } = await supabase
    .from("profiles")
    .select("mobile_phone, exotel_virtual_number")
    .eq("id", user.id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("call_logs")
    .select(
      "id, call_sid, to_number, from_number, agent_number, company_name, notes, status, duration_seconds, conversation_duration_seconds, started_at, ended_at, created_at, recording_sid, recording_duration_seconds, transcript, transcript_segments"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];

  // Auto-refresh in-progress calls and recent answered rows missing talk durations.
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const stuck = rows.filter((r) => r.status === "in-progress" && r.call_sid);
  const missingTalk = rows
    .filter((r) => rowNeedsTalkDurationBackfill(r))
    .slice(0, 12);
  const toRefresh = [...stuck, ...missingTalk];
  if (toRefresh.length > 0) {
    await Promise.all(
      toRefresh.map(async (row) => {
        const patch = await refreshFromExotel(row.call_sid, row.from_number);
        if (!patch) return;
        await svc.from("call_logs").update(patch).eq("id", row.id);
        Object.assign(row, patch);
      })
    );
  }

  // Derive direction + peer (the "other party" number, never our own).
  // Incoming: from_number = external caller, to_number = our agent.
  // Outbound: from_number = our virtual number, to_number = destination.
  const userMobile = (telephony?.mobile_phone as string | null) ?? "";
  const userExotel = (telephony?.exotel_virtual_number as string | null) ?? "";
  const allVirtuals = [
    ...listConfiguredExotelNumbers(),
    ...(userExotel ? [normalizePhone(userExotel)] : []),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const enriched = rows.map((r) => {
    const fromIsVirtual = allVirtuals.some((v) => phoneMatches(v, r.from_number ?? ""));
    const toIsUserMobile = userMobile && phoneMatches(userMobile, r.to_number ?? "");
    const fromIsExternal =
      r.from_number &&
      !allVirtuals.some((v) => phoneMatches(v, r.from_number ?? "")) &&
      !(userMobile && phoneMatches(userMobile, r.from_number ?? ""));

    let direction: "incoming" | "outbound" = "outbound";
    if (fromIsVirtual) direction = "outbound";
    else if (toIsUserMobile && fromIsExternal) direction = "incoming";
    else if (fromIsExternal) direction = "incoming";

    const peer_number = direction === "incoming" ? r.from_number : r.to_number;
    return { ...r, direction, peer_number };
  });

  return NextResponse.json({
    logs: enriched,
    telephony: {
      mobilePhone: userMobile || null,
      exotelVirtualNumber: userExotel || null,
    },
  });
}

export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    to?: string;
    agentPhone?: string;
  } | null;
  const to = body?.to?.trim() || "";
  let agentPhone = body?.agentPhone?.trim() || "";

  const { data: telephony, error: telErr } = await supabase
    .from("profiles")
    .select("mobile_phone, exotel_virtual_number")
    .eq("id", user.id)
    .maybeSingle();
  if (telErr) return NextResponse.json({ error: telErr.message }, { status: 500 });

  const profileMobile = (telephony?.mobile_phone as string | null)?.trim() ?? "";
  const profileExotel = (telephony?.exotel_virtual_number as string | null)?.trim() ?? "";
  if (!agentPhone && profileMobile) agentPhone = profileMobile;

  if (!isValidE164(normalizePhone(to))) {
    return NextResponse.json(
      { error: "Provide a valid phone number with country code, e.g. +919876543210." },
      { status: 400 }
    );
  }
  if (!agentPhone) {
    return NextResponse.json(
      {
        error:
          "Your mobile number is not set. Ask your admin to add it under Team, or set it in the dialer.",
      },
      { status: 400 }
    );
  }
  if (!isValidE164(normalizePhone(agentPhone))) {
    return NextResponse.json(
      { error: "Agent phone must include country code, e.g. +918056101540." },
      { status: 400 }
    );
  }
  agentPhone = normalizePhone(agentPhone);

  const exotelLine =
    profileExotel ||
    listConfiguredExotelNumbers()[0] ||
    process.env.EXOTEL_VIRTUAL_NUMBER?.trim() ||
    "";
  if (!exotelLine) {
    return NextResponse.json(
      { error: "No Exotel number assigned. Ask your admin to assign one under Team." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("call_logs")
    .insert({
      user_id: user.id,
      call_sid: `pending_${Date.now()}`,
      to_number: normalizePhone(to),
      from_number: normalizePhone(exotelLine),
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

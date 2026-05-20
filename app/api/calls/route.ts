import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

function validPhone(input: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(input.replace(/\s+/g, ""));
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

  return NextResponse.json({ logs: data || [] });
}

export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
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
      agent_number: "",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

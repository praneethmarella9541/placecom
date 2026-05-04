import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { normalizePeerE164 } from "@/lib/whatsapp-address";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const peer = new URL(request.url).searchParams.get("peer")?.trim();
  if (!peer) {
    return NextResponse.json({ error: "peer query required (E.164, e.g. +15551234567)" }, { status: 400 });
  }

  let peerNorm: string;
  try {
    peerNorm = normalizePeerE164(peer);
  } catch {
    return NextResponse.json({ error: "Invalid peer phone" }, { status: 400 });
  }

  const { data: rows, error } = await supabase
    .from("sms_messages")
    .select("id, direction, peer_e164, from_addr, to_addr, body, message_sid, created_at")
    .eq("peer_e164", peerNorm)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: rows || [] });
}

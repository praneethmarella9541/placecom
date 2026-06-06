import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getUserSmsLine } from "@/lib/sms-telephony";
import { normalizePeerE164 } from "@/lib/whatsapp-address";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const peer = new URL(request.url).searchParams.get("peer")?.trim();
  if (!peer) {
    return NextResponse.json({ error: "peer query required (E.164, e.g. +919876543210)" }, { status: 400 });
  }

  let peerNorm: string;
  try {
    peerNorm = normalizePeerE164(peer);
  } catch {
    return NextResponse.json({ error: "Invalid peer phone" }, { status: 400 });
  }

  // Scope to the user's assigned Exotel line (include legacy null-line rows).
  const lineResult = await getUserSmsLine(supabase, user.id);
  if (!lineResult.ok) {
    return NextResponse.json({ error: lineResult.error, messages: [] }, { status: lineResult.status });
  }
  const businessLine = lineResult.line;

  const { data: rows, error } = await supabase
    .from("sms_messages")
    .select("id, direction, peer_e164, from_addr, to_addr, body, message_sid, delivery_status, created_at")
    .eq("peer_e164", peerNorm)
    .or(`business_e164.eq.${businessLine},business_e164.is.null`)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: rows || [] });
}

import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";
import { normalizePeerE164 } from "@/lib/whatsapp-address";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const lineResult = await getUserWhatsAppLine(supabase, user.id);
  if (!lineResult.ok) {
    return NextResponse.json({ error: lineResult.error }, { status: lineResult.status });
  }
  const businessLine = lineResult.data.line;

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
    .from("whatsapp_messages")
    .select(
      "id, direction, peer_e164, business_e164, from_addr, to_addr, body, message_sid, created_at, reply_to_id, is_starred, is_pinned, deleted_at, delivery_status"
    )
    .eq("peer_e164", peerNorm)
    .eq("business_e164", businessLine)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    if (/business_e164/i.test(error.message ?? "")) {
      return NextResponse.json(
        { error: "Apply migration 0024_whatsapp_business_line.sql for per-user WhatsApp." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: rows || [], businessLine });
}

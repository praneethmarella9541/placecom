import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { canonicalWhatsAppPeer } from "@/lib/whatsapp-peer";

export const runtime = "nodejs";

/** Mark a WhatsApp thread read (shared across web + mobile via wa_thread_reads). */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { peer?: string; readAt?: string };
  try {
    body = (await request.json()) as { peer?: string; readAt?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const peer = canonicalWhatsAppPeer(String(body.peer ?? "").trim());
  if (!peer) {
    return NextResponse.json({ error: "Invalid peer" }, { status: 400 });
  }

  const at = body.readAt?.trim() || new Date().toISOString();

  const { error } = await supabase.from("wa_thread_reads").upsert(
    {
      user_id: user.id,
      peer_e164: peer,
      read_at: at,
      updated_at: at,
    },
    { onConflict: "user_id,peer_e164" }
  );

  if (error) {
    if (/wa_thread_reads/i.test(error.message) && /does not exist|42P01/i.test(error.message)) {
      return NextResponse.json({ ok: true, warning: "wa_thread_reads table missing" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, peer, readAt: at });
}

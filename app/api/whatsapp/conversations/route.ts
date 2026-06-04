import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { canonicalWhatsAppPeer, peerKeysForQuery } from "@/lib/whatsapp-peer";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const lineResult = await getUserWhatsAppLine(supabase, user.id);
  if (!lineResult.ok) {
    return NextResponse.json(
      { error: lineResult.error, conversations: [], businessLine: null },
      { status: lineResult.status }
    );
  }
  const businessLine = lineResult.data.line;

  const { data: rows, error } = await supabase
    .from("whatsapp_messages")
    .select("peer_e164, body, created_at, direction, deleted_at, business_e164")
    .eq("business_e164", businessLine)
    .order("created_at", { ascending: false })
    .limit(600);

  if (error && /business_e164/i.test(error.message ?? "")) {
    return NextResponse.json(
      {
        error: "whatsapp_messages.business_e164 missing. Apply migration 0024_whatsapp_business_line.sql.",
        conversations: [],
        businessLine,
      },
      { status: 503 }
    );
  }

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      return NextResponse.json(
        {
          error: "whatsapp_messages table missing. Apply migration 0016_whatsapp_messages.sql.",
          conversations: [],
          businessLine,
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const readAtByPeer = new Map<string, string>();
  const { data: readRows } = await supabase
    .from("wa_thread_reads")
    .select("peer_e164, read_at")
    .eq("user_id", user.id);
  for (const row of readRows ?? []) {
    const key = canonicalWhatsAppPeer((row.peer_e164 as string) || "");
    if (key && row.read_at) readAtByPeer.set(key, row.read_at as string);
  }

  function latestReadAt(peer: string): string | undefined {
    let best: string | undefined;
    for (const key of peerKeysForQuery(peer)) {
      const at = readAtByPeer.get(canonicalWhatsAppPeer(key));
      if (!at) continue;
      if (!best || new Date(at).getTime() > new Date(best).getTime()) best = at;
    }
    return readAtByPeer.get(peer) ?? best;
  }

  const byPeer = new Map<
    string,
    {
      peer_e164: string;
      last_body: string | null;
      last_at: string;
      last_dir: string;
      unread_count: number;
    }
  >();
  for (const r of rows || []) {
    if (r.deleted_at) continue;
    const peer = canonicalWhatsAppPeer((r.peer_e164 as string) || "");
    if (!peer) continue;
    const createdAt = r.created_at as string;
    const isInbound = r.direction === "inbound";
    const readAt = latestReadAt(peer);
    const countsAsUnread =
      isInbound &&
      (!readAt || new Date(createdAt).getTime() > new Date(readAt).getTime() + 50);

    const existing = byPeer.get(peer);
    if (!existing) {
      byPeer.set(peer, {
        peer_e164: peer,
        last_body: (r.body as string | null) ?? null,
        last_at: createdAt,
        last_dir: r.direction as string,
        unread_count: countsAsUnread ? 1 : 0,
      });
    } else {
      const unread = existing.unread_count + (countsAsUnread ? 1 : 0);
      if (new Date(createdAt).getTime() > new Date(existing.last_at).getTime()) {
        byPeer.set(peer, {
          peer_e164: peer,
          last_body: (r.body as string | null) ?? null,
          last_at: createdAt,
          last_dir: r.direction as string,
          unread_count: unread,
        });
      } else {
        byPeer.set(peer, { ...existing, unread_count: unread });
      }
    }
  }

  const conversations = Array.from(byPeer.values()).sort(
    (a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime()
  );

  return NextResponse.json({ conversations, businessLine });
}

import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
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

  const byPeer = new Map<
    string,
    { peer_e164: string; last_body: string | null; last_at: string; last_dir: string }
  >();
  for (const r of rows || []) {
    if (r.deleted_at) continue;
    const peer = r.peer_e164 as string;
    if (!byPeer.has(peer)) {
      byPeer.set(peer, {
        peer_e164: peer,
        last_body: (r.body as string | null) ?? null,
        last_at: r.created_at as string,
        last_dir: r.direction as string,
      });
    }
  }

  const conversations = Array.from(byPeer.values()).sort(
    (a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime()
  );

  return NextResponse.json({ conversations, businessLine });
}

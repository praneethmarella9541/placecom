import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getUserSmsLine } from "@/lib/sms-telephony";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Each staff member only sees threads on the Exotel line the admin assigned.
  const lineResult = await getUserSmsLine(supabase, user.id);
  if (!lineResult.ok) {
    return NextResponse.json({ error: lineResult.error, conversations: [] }, { status: lineResult.status });
  }
  const businessLine = lineResult.line;

  // Match this user's line; include legacy rows with no business_e164 set yet.
  const { data: rows, error } = await supabase
    .from("sms_messages")
    .select("peer_e164, body, created_at, direction, business_e164")
    .or(`business_e164.eq.${businessLine},business_e164.is.null`)
    .order("created_at", { ascending: false })
    .limit(600);

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42P01") {
      return NextResponse.json(
        { error: "sms_messages table missing. Apply migration 0018_sms_messages.sql.", conversations: [] },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byPeer = new Map<string, { peer_e164: string; last_body: string | null; last_at: string; last_dir: string }>();
  for (const r of rows || []) {
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
    (a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime(),
  );

  return NextResponse.json({ conversations });
}

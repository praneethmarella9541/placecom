import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { canonicalWhatsAppPeer, peerKeysForQuery } from "@/lib/whatsapp-peer";

export const runtime = "nodejs";

type ContactRow = { peer_e164: string; name: string };

/** GET /api/whatsapp/contacts — return all saved contacts for the signed-in user */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("wa_contacts")
    .select("peer_e164, name")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (error) {
    if (/relation.*wa_contacts.*does not exist/i.test(error.message)) {
      return NextResponse.json({ contacts: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contacts: (data ?? []) as ContactRow[] });
}

/** POST /api/whatsapp/contacts — upsert a contact name */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { peer_e164?: string; name?: string } | null;
  const peerRaw = body?.peer_e164?.trim();
  const name = body?.name?.trim();

  if (!peerRaw) return NextResponse.json({ error: "peer_e164 is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const peer = canonicalWhatsAppPeer(peerRaw);
  if (!peer || !/^\+[1-9]\d{7,14}$/.test(peer)) {
    return NextResponse.json({ error: "Invalid peer phone" }, { status: 400 });
  }

  const variantKeys = peerKeysForQuery(peer);
  if (variantKeys.length) {
    await supabase
      .from("wa_contacts")
      .delete()
      .eq("user_id", user.id)
      .in("peer_e164", variantKeys);
  }

  const { error } = await supabase
    .from("wa_contacts")
    .upsert(
      { user_id: user.id, peer_e164: peer, name, updated_at: new Date().toISOString() },
      { onConflict: "user_id,peer_e164" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/whatsapp/contacts — remove a saved contact name */
export async function DELETE(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { peer_e164?: string } | null;
  const peerRaw = body?.peer_e164?.trim();
  if (!peerRaw) return NextResponse.json({ error: "peer_e164 is required" }, { status: 400 });

  const peerKeys = peerKeysForQuery(peerRaw);
  if (!peerKeys.length) {
    return NextResponse.json({ error: "Invalid peer phone" }, { status: 400 });
  }

  const { error } = await supabase
    .from("wa_contacts")
    .delete()
    .eq("user_id", user.id)
    .in("peer_e164", peerKeys);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

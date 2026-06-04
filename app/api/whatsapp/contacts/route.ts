import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type ContactRow = { peer_e164: string; name: string };

/** GET /api/whatsapp/contacts — return all saved contacts for the signed-in user */
export async function GET() {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("wa_contacts")
    .select("peer_e164, name")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (error) {
    // Table may not exist yet (migration not run)
    if (/relation.*wa_contacts.*does not exist/i.test(error.message)) {
      return NextResponse.json({ contacts: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ contacts: (data ?? []) as ContactRow[] });
}

/** POST /api/whatsapp/contacts — upsert a contact name */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { peer_e164?: string; name?: string } | null;
  const peer = body?.peer_e164?.trim();
  const name = body?.name?.trim();

  if (!peer) return NextResponse.json({ error: "peer_e164 is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

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
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { peer_e164?: string } | null;
  const peer = body?.peer_e164?.trim();
  if (!peer) return NextResponse.json({ error: "peer_e164 is required" }, { status: 400 });

  const { error } = await supabase
    .from("wa_contacts")
    .delete()
    .eq("user_id", user.id)
    .eq("peer_e164", peer);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

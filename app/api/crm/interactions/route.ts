import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { resolveMailboxOwnerId } from "@/lib/team-scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const leadId = searchParams.get("leadId");

  if (!leadId) {
    return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
  }

  // No user_id filter: RLS scopes this to "my own" for staff, "my whole
  // team's" for an admin (see 0048 migration) — matches leads GET above.
  const { data: interactions, error } = await supabase
    .from("lead_interactions")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET Interactions error:", error);
    return NextResponse.json({ error: "Database error: " + error.message }, { status: 500 });
  }

  return NextResponse.json({ interactions });
}

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { lead_id, interaction_type, notes } = body;

    if (!lead_id || !interaction_type) {
      return NextResponse.json({ error: "Lead ID and Interaction Type are required" }, { status: 400 });
    }

    const mailboxOwnerId = await resolveMailboxOwnerId(supabase, user.id);

    const { data: newInteraction, error } = await supabase
      .from("lead_interactions")
      .insert({
        lead_id,
        user_id: user.id,
        mailbox_owner_id: mailboxOwnerId,
        interaction_type,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ interaction: newInteraction });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create interaction";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

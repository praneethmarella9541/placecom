import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createServerSupabaseClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const leadId = params.id;
    const body = await request.json();
    const { stage, stage_id, stage_set_by, score, company_name, contact_name, email, phone, staff_name, lead_type, jd_count } = body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (stage !== undefined) {
      updates.stage = stage;
      updates.stage_updated_at = new Date().toISOString();
    }
    // Board placement (crm_stages, migration 0054). Moving a card by hand
    // stamps stage_set_by='human' so a later re-classify won't undo it —
    // and clears the stale AI rationale, which no longer explains where the
    // card actually is.
    if (stage_id !== undefined) {
      updates.stage_id = stage_id || null;
      updates.stage_updated_at = new Date().toISOString();
      if (stage_set_by === undefined) updates.stage_set_by = "human";
    }
    if (stage_set_by === "human" || stage_set_by === "ai") {
      updates.stage_set_by = stage_set_by;
      if (stage_set_by === "human") {
        updates.ai_rationale = null;
        updates.ai_confidence = null;
      }
    }
    if (score !== undefined) updates.score = score;
    if (company_name !== undefined) updates.company_name = company_name;
    if (contact_name !== undefined) updates.contact_name = contact_name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (staff_name !== undefined) updates.staff_name = staff_name;
    if (lead_type !== undefined) updates.lead_type = lead_type;
    if (jd_count !== undefined) updates.jd_count = jd_count;

    const { data: updatedLead, error } = await supabase
      .from("leads")
      .update(updates)
      .eq("id", leadId)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ lead: updatedLead });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update lead";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

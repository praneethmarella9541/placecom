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
    const { stage, score, company_name, contact_name, email, phone, staff_name, lead_type, jd_count } = body;

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (stage !== undefined) {
      updates.stage = stage;
      updates.stage_updated_at = new Date().toISOString();
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

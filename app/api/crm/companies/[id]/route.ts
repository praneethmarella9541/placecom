import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: company, error: companyError } = await supabase
    .from("crm_companies")
    .select("*")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (companyError || !company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const { data: contacts, error: contactsError } = await supabase
    .from("crm_company_contacts")
    .select("*")
    .eq("company_id", params.id)
    .eq("user_id", user.id)
    .order("last_interaction_at", { ascending: false, nullsFirst: false });

  if (contactsError) {
    return NextResponse.json({ error: contactsError.message }, { status: 500 });
  }

  return NextResponse.json({ company, contacts: contacts || [] });
}

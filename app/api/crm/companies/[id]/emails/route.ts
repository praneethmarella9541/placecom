import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { fetchCompanyEmailActivity } from "@/lib/company-activity";

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

  const { data: contacts, error: contactsError } = await supabase
    .from("crm_company_contacts")
    .select("email")
    .eq("company_id", params.id)
    .eq("user_id", user.id);

  if (contactsError) {
    return NextResponse.json({ error: contactsError.message }, { status: 500 });
  }

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const searchQuery = new URL(request.url).searchParams.get("q") || undefined;

  try {
    const emails = await fetchCompanyEmailActivity(
      auth.accessToken,
      (contacts || []).map((c) => c.email),
      { mode: "full", maxResults: 25, searchQuery }
    );
    return NextResponse.json({ emails });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load emails";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

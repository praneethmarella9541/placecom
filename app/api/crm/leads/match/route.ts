import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { matchLeadToContact } from "@/lib/lead-contact-match";

export const runtime = "nodejs";

/**
 * GET /api/crm/leads/match?email=&phone= — best-matching CRM lead for a directory
 * contact, used by the contact detail page's Active Deal Info panel. Requires
 * leads' shared-read RLS (0041_leads_call_logs_shared_rls.sql) to see teammates' leads.
 */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const email = url.searchParams.get("email") || undefined;
  const phone = url.searchParams.get("phone") || undefined;
  if (!email && !phone) return NextResponse.json({ lead: null });

  const lead = await matchLeadToContact(supabase, { email, phone });
  return NextResponse.json({ lead });
}

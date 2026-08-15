import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, phoneLookupVariants } from "@/lib/phone";

export type MatchedLead = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  score: string;
  lead_type: string;
  jd_count: number;
  staff_name: string;
};

const LEAD_SELECT =
  "id, company_name, contact_name, email, phone, stage, score, lead_type, jd_count, staff_name";

/**
 * Best-effort match of a directory contact to an existing CRM lead — email first
 * (exact, case-insensitive), phone second (normalized variants). Returns the most
 * recently touched match if more than one lead shares the same email/phone.
 * Requires leads' shared-read RLS (0041_leads_call_logs_shared_rls.sql).
 */
export async function matchLeadToContact(
  supabase: SupabaseClient,
  { email, phone }: { email?: string | null; phone?: string | null }
): Promise<MatchedLead | null> {
  if (email) {
    const { data } = await supabase
      .from("leads")
      .select(LEAD_SELECT)
      .ilike("email", email.trim())
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as MatchedLead;
  }

  if (phone) {
    const variants = phoneLookupVariants(normalizePhone(phone));
    if (variants.length > 0) {
      const { data } = await supabase
        .from("leads")
        .select(LEAD_SELECT)
        .in("phone", variants)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return data as MatchedLead;
    }
  }

  return null;
}

/**
 * Batched version of matchLeadToContact for list views (e.g. the directory table's
 * Status column) — one query instead of one-per-contact. Builds lookup maps keyed
 * by lowercased email and by normalized phone; ties broken by most-recently-updated.
 */
export async function buildLeadMatchMaps(
  supabase: SupabaseClient
): Promise<{ byEmail: Map<string, MatchedLead>; byPhone: Map<string, MatchedLead> }> {
  const byEmail = new Map<string, MatchedLead>();
  const byPhone = new Map<string, MatchedLead>();

  const { data } = await supabase
    .from("leads")
    .select(`${LEAD_SELECT}, updated_at`)
    .order("updated_at", { ascending: true })
    .limit(5000);

  for (const lead of (data ?? []) as (MatchedLead & { updated_at: string })[]) {
    if (lead.email) byEmail.set(lead.email.trim().toLowerCase(), lead);
    if (lead.phone) {
      for (const v of phoneLookupVariants(normalizePhone(lead.phone))) byPhone.set(v, lead);
    }
  }

  return { byEmail, byPhone };
}

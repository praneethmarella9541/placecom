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

/** Just enough to render the directory's Status column — see buildLeadMatchMaps. */
export type LeadStatus = {
  email: string | null;
  phone: string | null;
  /** The board column's name (crm_stages), falling back to the legacy `stage` enum. */
  stage: string;
  score: string;
  /** The board column's colour, so the directory chip matches the kanban card. */
  stageColor: string | null;
};

type LeadStatusRow = {
  email: string | null;
  phone: string | null;
  stage: string;
  score: string;
  stage_id?: string | null;
};

const LEAD_BASE_SELECT =
  "id, company_name, contact_name, email, phone, stage, score, lead_type, jd_count, staff_name";
/** stage_id only exists from migration 0054 — see findLead's fallback. */
const LEAD_SELECT = `${LEAD_BASE_SELECT}, stage_id`;

type LeadWithStageId = MatchedLead & { stage_id?: string | null };

/**
 * The single most-recent lead matching an email or any of a set of phone
 * variants. Retries without stage_id on a database that predates migration
 * 0054 — otherwise the whole contact detail panel would go blank there rather
 * than just missing the board column name.
 */
async function findLead(
  supabase: SupabaseClient,
  filter: { email: string } | { phones: string[] }
): Promise<LeadWithStageId | null> {
  for (const select of [LEAD_SELECT, LEAD_BASE_SELECT]) {
    const base = supabase.from("leads").select(select);
    const filtered =
      "email" in filter ? base.ilike("email", filter.email) : base.in("phone", filter.phones);
    const { data, error } = await filtered
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error) return (data as LeadWithStageId | null) ?? null;
    // Anything other than "stage_id doesn't exist" is a real failure; retrying
    // with a narrower select would just fail again.
    if (!/stage_id/i.test(error.message)) return null;
  }
  return null;
}

/**
 * Swaps the legacy `stage` enum for the lead's actual board column name, so the
 * contact detail panel reports the same classification the kanban shows. A lead
 * with no stage_id (or a database without migration 0054) keeps the enum.
 */
async function withBoardStage(
  supabase: SupabaseClient,
  lead: LeadWithStageId
): Promise<MatchedLead> {
  if (!lead.stage_id) return lead;
  const names = await loadStageNames(supabase, [lead.stage_id]);
  const board = names.get(lead.stage_id);
  return board ? { ...lead, stage: board.name } : lead;
}

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
    const found = await findLead(supabase, { email: email.trim() });
    if (found) return withBoardStage(supabase, found);
  }

  if (phone) {
    const variants = phoneLookupVariants(normalizePhone(phone));
    if (variants.length > 0) {
      const found = await findLead(supabase, { phones: variants });
      if (found) return withBoardStage(supabase, found);
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
): Promise<{ byEmail: Map<string, LeadStatus>; byPhone: Map<string, LeadStatus> }> {
  const byEmail = new Map<string, LeadStatus>();
  const byPhone = new Map<string, LeadStatus>();

  // Only the columns the Status chip needs, not the full MatchedLead shape —
  // this runs on every directory list load over as many as 5000 rows.
  //
  // stage_id arrives with migration 0054; on a database where that hasn't been
  // applied the select errors, so retry without it and fall back to the legacy
  // `stage` enum rather than dropping the Status column entirely.
  let rows: LeadStatusRow[] = [];
  const withStageId = await supabase
    .from("leads")
    .select("email, phone, stage, score, stage_id")
    .order("updated_at", { ascending: true })
    .limit(5000);

  if (withStageId.error) {
    const { data } = await supabase
      .from("leads")
      .select("email, phone, stage, score")
      .order("updated_at", { ascending: true })
      .limit(5000);
    rows = (data ?? []) as LeadStatusRow[];
  } else {
    rows = (withStageId.data ?? []) as LeadStatusRow[];
  }

  const stageNames = await loadStageNames(
    supabase,
    rows.map((r) => r.stage_id).filter((id): id is string => Boolean(id))
  );

  for (const row of rows) {
    const board = row.stage_id ? stageNames.get(row.stage_id) : undefined;
    const lead: LeadStatus = {
      email: row.email,
      phone: row.phone,
      // The board column is the real classification now; the enum is only a
      // stand-in for leads that predate the board or sit outside it.
      stage: board?.name ?? row.stage,
      score: row.score,
      stageColor: board?.color ?? null,
    };
    if (lead.email) byEmail.set(lead.email.trim().toLowerCase(), lead);
    if (lead.phone) {
      for (const v of phoneLookupVariants(normalizePhone(lead.phone))) byPhone.set(v, lead);
    }
  }

  return { byEmail, byPhone };
}

/**
 * id -> {name, colour} for the board columns actually in use. Best-effort: on a
 * database without migration 0054 there is no crm_stages table, and the Status
 * column should degrade to the legacy enum rather than fail the whole request.
 */
async function loadStageNames(
  supabase: SupabaseClient,
  stageIds: string[]
): Promise<Map<string, { name: string; color: string | null }>> {
  const map = new Map<string, { name: string; color: string | null }>();
  const ids = Array.from(new Set(stageIds));
  if (ids.length === 0) return map;
  try {
    const { data } = await supabase.from("crm_stages").select("id, name, color").in("id", ids);
    for (const row of data ?? []) {
      map.set(row.id as string, {
        name: row.name as string,
        color: (row.color as string | null) ?? null,
      });
    }
  } catch {
    // crm_stages missing — callers fall back to the legacy stage.
  }
  return map;
}

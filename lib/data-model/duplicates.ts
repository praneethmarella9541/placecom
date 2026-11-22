import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeForMatch } from "./duplicate-match";

/**
 * Duplicate DETECTION only — never merge (see migration 0102's comment). A rule names the fields
 * that, together, identify the same real thing; if every one of them matches an existing record,
 * that's a suspected duplicate. `action` decides what happens: 'block' refuses the save, 'warn'
 * lets it through with the match attached to the result, 'report_only' lets it through silently.
 */

export type DuplicateRule = { id: string; name: string; fields: string[]; matchType: "exact" | "normalized"; action: "block" | "warn" | "report_only" };
export type DuplicateMatch = { rule: Pick<DuplicateRule, "id" | "name" | "action">; records: { id: string; name: string }[] };

type RawRule = { id: string; name: string; fields: string[]; match_type: "exact" | "normalized"; action: "block" | "warn" | "report_only" };

async function loadRules(svc: SupabaseClient, org: string, objectId: string): Promise<DuplicateRule[]> {
  const { data, error } = await svc
    .from("data_duplicate_rules")
    .select("id, name, fields, match_type, action")
    .eq("org_owner_id", org)
    .eq("object_id", objectId)
    .eq("active", true);
  if (error) return [];
  return ((data ?? []) as RawRule[]).map((r) => ({ id: r.id, name: r.name, fields: r.fields, matchType: r.match_type, action: r.action }));
}

/**
 * Every active duplicate rule that matches the values this save would produce, each with up to 5
 * other records it matched (excluding `excludeId`, the record being updated). A rule where any of
 * its fields is currently blank is skipped — nothing to compare yet.
 */
export async function findDuplicates(
  svc: SupabaseClient,
  org: string,
  objectId: string,
  values: Record<string, unknown>,
  name: string | undefined,
  excludeId?: string
): Promise<DuplicateMatch[]> {
  const rules = await loadRules(svc, org, objectId);
  if (!rules.length) return [];

  const out: DuplicateMatch[] = [];
  for (const rule of rules) {
    const keys = rule.fields.map((f) => normalizeForMatch(f === "name" ? name : values[f], rule.matchType));
    if (keys.some((k) => k === null)) continue;

    let q = svc.from("data_records").select("id, name").eq("org_owner_id", org).eq("object_id", objectId).is("deleted_at", null);
    if (excludeId) q = q.neq("id", excludeId);
    for (let i = 0; i < rule.fields.length; i++) {
      const field = rule.fields[i];
      const path = field === "name" ? "name" : `values->>${field}`;
      // "normalized" is case-insensitive; values are already trimmed at save time, so an exact
      // (no-wildcard) ilike is exactly that, with nothing further to normalize on the way in.
      q = rule.matchType === "exact" ? q.eq(path, keys[i] as string) : q.ilike(path, keys[i] as string);
    }
    const { data: matches } = await q.limit(5);
    if (matches?.length) out.push({ rule: { id: rule.id, name: rule.name, action: rule.action }, records: matches as { id: string; name: string }[] });
  }
  return out;
}

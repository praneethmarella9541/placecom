import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-tenant rollout switch for the formula rules engine (migration 0100). A database without the
 * migration, or a workspace with no row, both mean "off" — the only state that ever existed before
 * this table did — so adding this flag can never itself change anyone's behaviour.
 */

const TTL_MS = 20_000;
const cache = new Map<string, { at: number; on: boolean }>();

export async function isFormulaEngineEnabled(svc: SupabaseClient, org: string): Promise<boolean> {
  const hit = cache.get(org);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.on;

  const { data, error } = await svc.from("data_rules_feature_flags").select("formula_engine").eq("org_owner_id", org).maybeSingle();
  const on = !error && data?.formula_engine === true;
  if (cache.size > 2000) cache.clear();
  cache.set(org, { at: Date.now(), on });
  return on;
}

export function invalidateRuleFlagCache(): void {
  cache.clear();
}

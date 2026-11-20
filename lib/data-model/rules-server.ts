import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Rule } from "./rules";

const COLUMNS = "id, name, condition, requirements";

/** Active record rules for an object. A database without 0093 has none, and nothing is blocked. */
export async function loadRecordRules(svc: SupabaseClient, org: string, objectId: string): Promise<Rule[]> {
  const { data, error } = await svc
    .from("data_validation_rules")
    .select(COLUMNS)
    .eq("org_owner_id", org)
    .eq("object_id", objectId)
    .eq("kind", "record")
    .eq("active", true);
  return error ? [] : ((data ?? []) as Rule[]);
}

/** Active rules for moving a card into one stage. */
export async function loadStageRules(svc: SupabaseClient, org: string, stageId: string): Promise<Rule[]> {
  const { data, error } = await svc
    .from("data_validation_rules")
    .select(COLUMNS)
    .eq("org_owner_id", org)
    .eq("kind", "stage")
    .eq("stage_id", stageId)
    .eq("active", true);
  return error ? [] : ((data ?? []) as Rule[]);
}

/** Remember a card entering a stage (and which it left). Best effort: history never blocks a move. */
export async function recordStageChange(
  svc: SupabaseClient,
  org: string,
  listId: string,
  entryId: string,
  fromStageId: string | null,
  toStageId: string | null,
  actorId: string
): Promise<void> {
  const { error } = await svc
    .from("data_list_entry_history")
    .insert({ org_owner_id: org, list_id: listId, entry_id: entryId, from_stage_id: fromStageId, to_stage_id: toStageId, actor_id: actorId });
  if (error && !/data_list_entry_history/.test(error.message)) console.error("[data-model] stage history failed:", error.code, error.message);
}

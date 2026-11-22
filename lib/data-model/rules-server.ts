import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Rule } from "./rules";

const LEGACY_COLUMNS = "id, name, condition, requirements";
const FORMULA_COLUMNS =
  "id, name, condition, requirements, format, api_name, description, applies_on, mode, error_location, message, expression_source, expression_ast, order_index, admin_bypass, version";

type RawRow = {
  id: string;
  name: string;
  condition: Rule["condition"];
  requirements: Rule["requirements"];
  format?: Rule["format"];
  api_name?: string | null;
  description?: string | null;
  applies_on?: Rule["appliesOn"];
  mode?: Rule["mode"];
  error_location?: string | null;
  message?: string | null;
  expression_source?: string | null;
  expression_ast?: unknown;
  order_index?: number;
  admin_bypass?: boolean;
  version?: number;
};

function toRule(row: RawRow): Rule {
  return {
    id: row.id,
    name: row.name,
    condition: row.condition,
    requirements: row.requirements,
    format: row.format ?? "legacy",
    apiName: row.api_name ?? null,
    description: row.description ?? null,
    appliesOn: row.applies_on ?? "both",
    mode: row.mode ?? "block",
    errorLocation: row.error_location ?? null,
    message: row.message ?? null,
    expressionSource: row.expression_source ?? null,
    expressionAst: row.expression_ast ?? null,
    orderIndex: row.order_index ?? 0,
    adminBypass: row.admin_bypass ?? false,
    version: row.version ?? 1,
  };
}

/** A database without migration 0101 applied yet: fall back to the original four columns, so a
 *  rule saved before 0101 keeps being enforced right up to the moment the migration runs, rather
 *  than this query's error being read as "no rules at all" (0093's deliberate behaviour when ITS
 *  migration is missing, which this reuses for an unrelated reason — a column, not a table). */
function isMissingColumn(message: string | undefined): boolean {
  return /column .* does not exist|schema cache/i.test(message ?? "");
}

/** Active record rules for an object. A database without 0093 has none, and nothing is blocked. */
export async function loadRecordRules(svc: SupabaseClient, org: string, objectId: string): Promise<Rule[]> {
  const first = await svc
    .from("data_validation_rules")
    .select(FORMULA_COLUMNS)
    .eq("org_owner_id", org)
    .eq("object_id", objectId)
    .eq("kind", "record")
    .eq("active", true)
    .order("order_index", { ascending: true })
    .order("name", { ascending: true });
  if (!first.error) return ((first.data ?? []) as unknown as RawRow[]).map(toRule);
  if (!isMissingColumn(first.error.message)) return [];

  const fallback = await svc
    .from("data_validation_rules")
    .select(LEGACY_COLUMNS)
    .eq("org_owner_id", org)
    .eq("object_id", objectId)
    .eq("kind", "record")
    .eq("active", true)
    .order("name", { ascending: true });
  return fallback.error ? [] : ((fallback.data ?? []) as unknown as RawRow[]).map(toRule);
}

/** Active rules for moving a card into one stage. */
export async function loadStageRules(svc: SupabaseClient, org: string, stageId: string): Promise<Rule[]> {
  const first = await svc
    .from("data_validation_rules")
    .select(FORMULA_COLUMNS)
    .eq("org_owner_id", org)
    .eq("kind", "stage")
    .eq("stage_id", stageId)
    .eq("active", true)
    .order("order_index", { ascending: true })
    .order("name", { ascending: true });
  if (!first.error) return ((first.data ?? []) as unknown as RawRow[]).map(toRule);
  if (!isMissingColumn(first.error.message)) return [];

  const fallback = await svc
    .from("data_validation_rules")
    .select(LEGACY_COLUMNS)
    .eq("org_owner_id", org)
    .eq("kind", "stage")
    .eq("stage_id", stageId)
    .eq("active", true)
    .order("name", { ascending: true });
  return fallback.error ? [] : ((fallback.data ?? []) as unknown as RawRow[]).map(toRule);
}

export type RuleScope = { rule: Rule; kind: "record" | "stage"; objectId: string; stageId: string | null };

/** One rule by id, with enough of its row (kind, object, stage) to know how to re-run it outside a
 *  real save — the impact scan and test-panel endpoints, neither of which goes through loadRecordRules
 *  or loadStageRules since both already know which object or stage they're scoped to. */
export async function loadRuleById(svc: SupabaseClient, org: string, id: string): Promise<RuleScope | null> {
  const first = await svc.from("data_validation_rules").select(`kind, object_id, stage_id, ${FORMULA_COLUMNS}`).eq("org_owner_id", org).eq("id", id).maybeSingle();
  if (!first.error) {
    if (!first.data) return null;
    const row = first.data as unknown as RawRow & { kind: "record" | "stage"; object_id: string; stage_id: string | null };
    return { rule: toRule(row), kind: row.kind, objectId: row.object_id, stageId: row.stage_id };
  }
  if (!isMissingColumn(first.error.message)) return null;

  const fallback = await svc.from("data_validation_rules").select(`kind, object_id, stage_id, ${LEGACY_COLUMNS}`).eq("org_owner_id", org).eq("id", id).maybeSingle();
  if (fallback.error || !fallback.data) return null;
  const row = fallback.data as unknown as RawRow & { kind: "record" | "stage"; object_id: string; stage_id: string | null };
  return { rule: toRule(row), kind: row.kind, objectId: row.object_id, stageId: row.stage_id };
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

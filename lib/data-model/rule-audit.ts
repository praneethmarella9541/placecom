import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Audit trail (migration 0103): one row per save where a rule actually mattered — it blocked the
 * save, it warned, or an admin's explicit bypass let a would-be block through anyway. Written from
 * lib/data-model/rule-engine-bridge.ts. Best effort throughout: a logging failure must never be the
 * reason a save fails, and a database without 0103 applied yet behaves exactly as it did before this
 * phase (nothing is logged, nothing breaks).
 */

export type RuleOutcome = "blocked" | "warned" | "bypassed";

function isMissingTable(message: string | undefined): boolean {
  return /relation .* does not exist|schema cache/i.test(message ?? "");
}

export async function logRuleOutcome(
  svc: SupabaseClient,
  org: string,
  entry: { ruleId: string; objectId: string | null; recordId: string | null; outcome: RuleOutcome; message: string; actorId: string }
): Promise<void> {
  const { error } = await svc.from("data_rule_evaluation_log").insert({
    org_owner_id: org,
    rule_id: entry.ruleId,
    object_id: entry.objectId,
    record_id: entry.recordId,
    outcome: entry.outcome,
    message: entry.message.slice(0, 2000),
    actor_id: entry.actorId,
  });
  if (error && !isMissingTable(error.message)) console.error("[data-model] rule audit log failed:", error.code, error.message);
}

export type RuleAuditEntry = {
  id: string;
  outcome: RuleOutcome;
  message: string | null;
  actorId: string | null;
  recordId: string | null;
  createdAt: string;
};

/** Most recent audit entries for one rule, newest first. Empty (not an error) if 0103 isn't applied yet. */
export async function listRuleAuditLog(svc: SupabaseClient, org: string, ruleId: string, limit = 50): Promise<RuleAuditEntry[]> {
  const { data, error } = await svc
    .from("data_rule_evaluation_log")
    .select("id, outcome, message, actor_id, record_id, created_at")
    .eq("org_owner_id", org)
    .eq("rule_id", ruleId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 200));
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    outcome: r.outcome as RuleOutcome,
    message: (r.message as string | null) ?? null,
    actorId: (r.actor_id as string | null) ?? null,
    recordId: (r.record_id as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

/** Snapshots a rule's row exactly as it was BEFORE a change, under the version number being
 *  superseded — so "version 3" in the history list means "what the rule said while it was v3". */
export async function snapshotRuleVersion(svc: SupabaseClient, org: string, ruleId: string, version: number, snapshot: Record<string, unknown>, changedBy: string): Promise<void> {
  const { error } = await svc.from("data_validation_rule_versions").insert({
    org_owner_id: org,
    rule_id: ruleId,
    version,
    snapshot,
    changed_by: changedBy,
  });
  if (error && !isMissingTable(error.message) && error.code !== "23505") console.error("[data-model] rule version snapshot failed:", error.code, error.message);
}

export type RuleVersionEntry = { version: number; snapshot: Record<string, unknown>; changedBy: string | null; createdAt: string };

/** Every stored snapshot of one rule, newest version first. */
export async function listRuleVersions(svc: SupabaseClient, org: string, ruleId: string): Promise<RuleVersionEntry[]> {
  const { data, error } = await svc
    .from("data_validation_rule_versions")
    .select("version, snapshot, changed_by, created_at")
    .eq("org_owner_id", org)
    .eq("rule_id", ruleId)
    .order("version", { ascending: false });
  if (error) return [];
  return (data ?? []).map((r) => ({
    version: r.version as number,
    snapshot: r.snapshot as Record<string, unknown>,
    changedBy: (r.changed_by as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { compileExpression, runExpression, type EvalContext, type Expr, type FormulaValue } from "../rules-engine/index";
import { buildObjectSchema } from "./rule-schema";
import { valuesToFormula } from "./rule-values";
import { isFormulaEngineEnabled } from "./rule-flags";
import { getRecord, loadAttributes, loadObjectById } from "./records";
import { appliesOnMatches, renderMessage, requirementErrorFormula, requirementMessage } from "./rule-formula-gen";
import { checkRecordRules, failedRequirements, type Rule } from "./rules";
import { loadRecordRules, loadStageRules } from "./rules-server";
import type { AttributeDef } from "./types";

/**
 * Bridges today's condition+requirements rules (lib/data-model/rules.ts) onto the new formula engine
 * (lib/rules-engine), so the same `data_validation_rules` rows the UI already writes are evaluated by
 * the new engine once a workspace opts in (lib/data-model/rule-flags.ts) — with the exact same
 * messages, in the exact same order, as the legacy evaluator. There is nothing new a rule can express
 * yet; this phase only proves the new engine is a drop-in replacement for the old one. The rule model
 * phase 3 adds (api_name, custom message, error location, ...) is additive on top of this bridge, not
 * a replacement for it — a workspace's existing rules keep working through every later phase.
 *
 * The formula generation itself (one small formula per requirement, not one formula for the whole
 * rule) lives in rule-formula-gen.ts, which is pure and has no database import, so it's what the
 * migration-equivalence tests exercise directly.
 */

async function isAdminUser(svc: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await svc.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role === "admin";
}

/**
 * One hop (or, recursively, two) across a record_ref field. Memoizes by record id within a single
 * evaluation pass — several rules or a 2-hop path reading the same linked record only fetch it once —
 * and refuses to read a record from an object this user has no access to at all, so a staff member's
 * formula can't be used to confirm the existence or contents of a record they couldn't otherwise see.
 *
 * Not yet wired to a hard per-save read-count budget or cross-rule batching (phase 6 — the limits and
 * performance-hardening phase); no legacy-converted rule (the only kind this phase runs) ever takes
 * this path at all, since the old condition/requirement model has no concept of a linked field.
 */
export function createLinkResolver(svc: SupabaseClient, org: string, actorUserId: string): EvalContext["resolveLink"] {
  const recordCache = new Map<string, ReturnType<typeof getRecord>>();
  let isAdminPromise: Promise<boolean> | null = null;

  function cachedRecord(id: string) {
    let p = recordCache.get(id);
    if (!p) {
      p = getRecord(svc, org, id);
      recordCache.set(id, p);
    }
    return p;
  }

  async function resolve(path: string[], fromId: string): Promise<FormulaValue> {
    const record = await cachedRecord(fromId);
    if (!record) return null;
    const object = await loadObjectById(svc, org, record.object_id);
    if (!object) return null;

    if (!isAdminPromise) isAdminPromise = isAdminUser(svc, actorUserId);
    const isAdmin = await isAdminPromise;
    if (!isAdmin && (object.staff_access ?? "write") === "none") return null;

    const field = path[0];
    if (field === "Name") return path.length === 1 ? record.name : null;

    const attrs = await loadAttributes(svc, org, object.id);
    const attr = attrs.find((a) => a.slug === field);
    if (!attr) return null;

    if (path.length === 1) return valuesToFormula(attrs, record.values, record.name)[field] ?? null;

    if (attr.type !== "record_ref") return null;
    const nextId = record.values[field];
    if (typeof nextId !== "string" || !nextId) return null;
    return resolve(path.slice(1), nextId);
  }

  return resolve;
}

export type RuleEvalMode = { isNew: boolean; priorValues?: Record<string, unknown> };

/**
 * `errors` are mode:"block" failures — the only thing any of the five call sites act on today,
 * same as before this phase. `warnings` are mode:"warn" failures: the save must NOT be blocked by
 * them. Phase 6 is where these get a banner and an audit-log row; for now a caller that doesn't
 * pass them on is still correct (a warn-mode rule never blocks), just not yet visible to anyone.
 */
export type RuleCheckResult = { errors: string[]; warnings: string[] };

function defaultFormulaMessage(rule: Rule): string {
  return `${rule.name}: this record doesn't pass validation.`;
}

async function evaluateViaEngine(
  svc: SupabaseClient,
  org: string,
  attrs: AttributeDef[],
  values: Record<string, unknown>,
  name: string | undefined,
  rules: Rule[],
  mode: RuleEvalMode,
  actorUserId: string,
  isStageContext: boolean
): Promise<RuleCheckResult> {
  const attrsBySlug = new Map(attrs.map((a) => [a.slug, a]));
  const schema = await buildObjectSchema(svc, org, attrs);
  const formulaValues = valuesToFormula(attrs, values, name);
  const ctx: EvalContext = {
    values: formulaValues,
    priorValues: mode.priorValues ? valuesToFormula(attrs, mode.priorValues, name) : undefined,
    isNew: mode.isNew,
    // $User/$Workspace are real for a phase-3+ authored rule; no legacy-converted formula ever
    // references them, so there is nothing yet worth an extra database round trip per save for.
    user: { id: actorUserId, role: "staff", groupName: null, email: "", emailDomain: "" },
    workspace: { id: org, name: "" },
    now: new Date(),
    timeZone: "Asia/Kolkata",
    resolveLink: createLinkResolver(svc, org, actorUserId),
  };

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of rules) {
    if (rule.format === "formula") {
      // appliesOn only means something for a record rule checked on create vs. update — a stage
      // rule's "condition" is always "entering this stage", so the setting doesn't apply there.
      if (!isStageContext && !appliesOnMatches(rule.appliesOn, mode.isNew)) continue;
      if (!rule.expressionAst) {
        console.error("[rule-engine-bridge] a formula rule has no compiled expression — it was saved without one, which shouldn't be possible:", rule.id);
        continue;
      }
      const result = await runExpression(rule.expressionAst as Expr, schema, ctx);
      if (!result.ok) {
        console.error("[rule-engine-bridge] formula evaluation failed:", result.error, rule.id);
        continue;
      }
      if (result.value !== true) continue;
      const message = rule.message ? renderMessage(rule.message, formulaValues) : defaultFormulaMessage(rule);
      (rule.mode === "warn" ? warnings : errors).push(message);
      continue;
    }

    for (const req of rule.requirements) {
      const source = requirementErrorFormula(rule.condition, req, attrsBySlug);
      const compiled = compileExpression(source, schema);
      if (!compiled.ok) {
        console.error("[rule-engine-bridge] a generated formula failed to compile — this is a bridge bug, not a bad rule:", compiled.error, source);
        continue;
      }
      const result = await runExpression(compiled.ast, schema, ctx);
      if (!result.ok) {
        console.error("[rule-engine-bridge] formula evaluation failed:", result.error, source);
        continue;
      }
      if (result.value === true) errors.push(requirementMessage(rule.name, req, attrsBySlug));
    }
  }
  return { errors, warnings };
}

/** Drop-in replacement for checkRecordRules(await loadRecordRules(...)), extended with `warnings`:
 *  same `errors` shape and meaning as before, routed through the new engine only once the
 *  workspace's flag is on. A 'formula' rule only ever runs through the new engine — there is no
 *  legacy evaluator for it — so the flag effectively gates "respect formula rules at all". */
export async function checkRecordRulesV2(
  svc: SupabaseClient,
  org: string,
  objectId: string,
  attrs: AttributeDef[],
  values: Record<string, unknown>,
  name: string | undefined,
  mode: RuleEvalMode,
  actorUserId: string
): Promise<RuleCheckResult> {
  const rules = await loadRecordRules(svc, org, objectId);
  if (!rules.length) return { errors: [], warnings: [] };
  if (!(await isFormulaEngineEnabled(svc, org))) {
    return { errors: checkRecordRules(rules.filter((r) => r.format !== "formula"), attrs, values, name), warnings: [] };
  }
  return evaluateViaEngine(svc, org, attrs, values, name, rules, mode, actorUserId, false);
}

/** Drop-in replacement for failedRequirements() over loadStageRules(), extended with `warnings` —
 *  see checkRecordRulesV2. */
export async function checkStageRulesV2(
  svc: SupabaseClient,
  org: string,
  stageId: string,
  attrs: AttributeDef[],
  values: Record<string, unknown>,
  name: string | undefined,
  actorUserId: string
): Promise<RuleCheckResult> {
  const rules = await loadStageRules(svc, org, stageId);
  if (!rules.length) return { errors: [], warnings: [] };
  if (!(await isFormulaEngineEnabled(svc, org))) {
    return { errors: rules.filter((r) => r.format !== "formula").flatMap((r) => failedRequirements(r, attrs, values, name)), warnings: [] };
  }
  // A stage rule's legacy condition is always null (entering the stage IS the condition); a
  // formula stage rule has no "condition" either — the whole expression is the check.
  return evaluateViaEngine(svc, org, attrs, values, name, rules, { isNew: false }, actorUserId, true);
}

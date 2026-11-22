import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { compileExpression, runExpression, type EvalContext, type Expr, type FormulaValue, type ObjectSchema } from "../rules-engine/index";
import { buildObjectSchema } from "./rule-schema";
import { valuesToFormula } from "./rule-values";
import { isFormulaEngineEnabled } from "./rule-flags";
import { getRecord, loadAttributes, loadObjectById } from "./records";
import { appliesOnMatches, renderMessage, requirementErrorFormula, requirementMessage } from "./rule-formula-gen";
import { logRuleOutcome } from "./rule-audit";
import { checkRecordRules, failedRequirements, missingRequiredFields, type Rule } from "./rules";
import { loadRecordRules, loadRuleById, loadStageRules } from "./rules-server";
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
 *
 * `missingFields` is the attribute slugs the caller could plausibly ask for instead of just
 * reverting: a legacy requirement's own field, or a blocked formula rule's error_location. Only
 * meaningful to a caller like the board's stage-move dialog that can offer a small form; ignored
 * (and still correctly populated) by the others.
 */
export type RuleCheckResult = { errors: string[]; warnings: string[]; missingFields: string[] };

/** Where to log an outcome, and whether this save asked to bypass an admin-bypassable rule. A
 *  bypass only ever takes effect for an actual admin — evaluateViaEngine checks that itself, so a
 *  caller can pass through whatever the request asked for without checking the role first. */
export type RuleAuditContext = { objectId: string | null; recordId: string | null; bypassRequested: boolean };

function defaultFormulaMessage(rule: Rule): string {
  return `${rule.name}: this record doesn't pass validation.`;
}

/**
 * Whether ONE rule matches a record right now, and the message(s) it would show — no side effects
 * (no audit log, no bypass decision), so it's safe to call many times over existing data (the
 * impact scan) or once against made-up values (the test panel), as well as from evaluateViaEngine's
 * real per-save loop below.
 */
async function matchesRule(
  rule: Rule,
  attrsBySlug: Map<string, AttributeDef>,
  schema: ObjectSchema,
  ctx: EvalContext,
  formulaValues: Record<string, FormulaValue>,
  isStageContext: boolean,
  isNew: boolean
): Promise<string[]> {
  if (rule.format === "formula") {
    // appliesOn only means something for a record rule checked on create vs. update — a stage
    // rule's "condition" is always "entering this stage", so the setting doesn't apply there.
    if (!isStageContext && !appliesOnMatches(rule.appliesOn, isNew)) return [];
    if (!rule.expressionAst) {
      console.error("[rule-engine-bridge] a formula rule has no compiled expression — it was saved without one, which shouldn't be possible:", rule.id);
      return [];
    }
    const result = await runExpression(rule.expressionAst as Expr, schema, ctx);
    if (!result.ok) {
      console.error("[rule-engine-bridge] formula evaluation failed:", result.error, rule.id);
      return [];
    }
    if (result.value !== true) return [];
    return [rule.message ? renderMessage(rule.message, formulaValues) : defaultFormulaMessage(rule)];
  }

  const out: string[] = [];
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
    if (result.value === true) out.push(requirementMessage(rule.name, req, attrsBySlug));
  }
  return out;
}

function buildEvalContext(
  svc: SupabaseClient,
  org: string,
  attrs: AttributeDef[],
  values: Record<string, unknown>,
  name: string | undefined,
  mode: RuleEvalMode,
  actorUserId: string
): { formulaValues: Record<string, FormulaValue>; ctx: EvalContext } {
  const formulaValues = valuesToFormula(attrs, values, name);
  return {
    formulaValues,
    ctx: {
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
    },
  };
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
  isStageContext: boolean,
  audit: RuleAuditContext
): Promise<RuleCheckResult> {
  const attrsBySlug = new Map(attrs.map((a) => [a.slug, a]));
  const schema = await buildObjectSchema(svc, org, attrs);
  const { formulaValues, ctx } = buildEvalContext(svc, org, attrs, values, name, mode, actorUserId);

  const errors: string[] = [];
  const warnings: string[] = [];
  const missingFields = new Set(missingRequiredFields(rules, values, name));

  // Only checked, and only once, if some rule is actually bypassable and this save asked for it —
  // most saves touch no admin_bypass rule at all, so this must not cost a query by default.
  let isAdminPromise: Promise<boolean> | null = null;
  const isAdmin = () => {
    if (!isAdminPromise) isAdminPromise = isAdminUser(svc, actorUserId);
    return isAdminPromise;
  };

  for (const rule of rules) {
    const messages = await matchesRule(rule, attrsBySlug, schema, ctx, formulaValues, isStageContext, mode.isNew);
    for (const message of messages) {
      if (rule.mode === "warn") {
        warnings.push(message);
        await logRuleOutcome(svc, org, { ruleId: rule.id, objectId: audit.objectId, recordId: audit.recordId, outcome: "warned", message, actorId: actorUserId });
      } else if (rule.adminBypass && audit.bypassRequested && (await isAdmin())) {
        warnings.push(`${message} (bypassed by an admin)`);
        await logRuleOutcome(svc, org, { ruleId: rule.id, objectId: audit.objectId, recordId: audit.recordId, outcome: "bypassed", message, actorId: actorUserId });
      } else {
        errors.push(message);
        if (rule.errorLocation) missingFields.add(rule.errorLocation);
        await logRuleOutcome(svc, org, { ruleId: rule.id, objectId: audit.objectId, recordId: audit.recordId, outcome: "blocked", message, actorId: actorUserId });
      }
    }
  }
  return { errors, warnings, missingFields: [...missingFields] };
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
  actorUserId: string,
  options: { recordId?: string | null; bypassRequested?: boolean } = {}
): Promise<RuleCheckResult> {
  const rules = await loadRecordRules(svc, org, objectId);
  if (!rules.length) return { errors: [], warnings: [], missingFields: [] };
  if (!(await isFormulaEngineEnabled(svc, org))) {
    const legacy = rules.filter((r) => r.format !== "formula");
    return { errors: checkRecordRules(legacy, attrs, values, name), warnings: [], missingFields: missingRequiredFields(legacy, values, name) };
  }
  const audit: RuleAuditContext = { objectId, recordId: options.recordId ?? null, bypassRequested: options.bypassRequested === true };
  return evaluateViaEngine(svc, org, attrs, values, name, rules, mode, actorUserId, false, audit);
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
  actorUserId: string,
  options: { objectId?: string | null; recordId?: string | null; bypassRequested?: boolean } = {}
): Promise<RuleCheckResult> {
  const rules = await loadStageRules(svc, org, stageId);
  if (!rules.length) return { errors: [], warnings: [], missingFields: [] };
  if (!(await isFormulaEngineEnabled(svc, org))) {
    const legacy = rules.filter((r) => r.format !== "formula");
    return { errors: legacy.flatMap((r) => failedRequirements(r, attrs, values, name)), warnings: [], missingFields: missingRequiredFields(legacy, values, name) };
  }
  // A stage rule's legacy condition is always null (entering the stage IS the condition); a
  // formula stage rule has no "condition" either — the whole expression is the check.
  const audit: RuleAuditContext = { objectId: options.objectId ?? null, recordId: options.recordId ?? null, bypassRequested: options.bypassRequested === true };
  return evaluateViaEngine(svc, org, attrs, values, name, rules, { isNew: false }, actorUserId, true, audit);
}

/**
 * Test panel: does ONE rule — saved or still a draft (the caller compiles/validates it first, same
 * as a real save would) — match a made-up record? No audit log row (nothing was actually saved)
 * and no bypass logic (there is nothing yet to bypass). Works for either format.
 */
export async function testRuleAgainstValues(
  svc: SupabaseClient,
  org: string,
  objectId: string,
  rule: Rule,
  values: Record<string, unknown>,
  name: string | undefined,
  isNew: boolean,
  isStageContext: boolean,
  actorUserId: string
): Promise<{ matched: boolean; messages: string[]; mode: "block" | "warn" }> {
  const attrs = await loadAttributes(svc, org, objectId);
  const attrsBySlug = new Map(attrs.map((a) => [a.slug, a]));
  const schema = await buildObjectSchema(svc, org, attrs);
  const { formulaValues, ctx } = buildEvalContext(svc, org, attrs, values, name, { isNew }, actorUserId);
  const messages = await matchesRule(rule, attrsBySlug, schema, ctx, formulaValues, isStageContext, isNew);
  return { matched: messages.length > 0, messages, mode: rule.mode === "warn" ? "warn" : "block" };
}

const MAX_IMPACT_SCAN = 1000;
const IMPACT_BATCH = 200;
const IMPACT_SAMPLE_SIZE = 10;

export type RuleImpactScan = { scanned: number; failing: number; sample: { id: string; name: string }[]; truncated: boolean };

/**
 * "Existing data" impact scan (spec 3.9): before activating or tightening a rule, how much of what's
 * already there would fail it right now? Capped at MAX_IMPACT_SCAN records — an admin-triggered,
 * occasional check, not a per-save hot path, so a capped scan beats a full-table one that might time
 * out on a large object. A stage rule is scanned against records CURRENTLY in that stage only, since
 * that's the only population it could plausibly be checked against again.
 */
export async function scanRuleImpact(svc: SupabaseClient, org: string, ruleId: string, actorUserId: string): Promise<({ ok: true } & RuleImpactScan) | { ok: false; error: string }> {
  const scope = await loadRuleById(svc, org, ruleId);
  if (!scope) return { ok: false, error: "Not found." };
  const { rule, kind, objectId, stageId } = scope;
  if (kind === "stage" && !stageId) return { ok: false, error: "This rule has no stage." };

  const attrs = await loadAttributes(svc, org, objectId);
  const attrsBySlug = new Map(attrs.map((a) => [a.slug, a]));
  const schema = await buildObjectSchema(svc, org, attrs);

  let stageRecordIds: string[] | null = null;
  if (kind === "stage") {
    const { data } = await svc.from("data_list_entries").select("record_id").eq("org_owner_id", org).eq("stage_id", stageId as string).limit(MAX_IMPACT_SCAN + 1);
    stageRecordIds = (data ?? []).map((r) => r.record_id as string);
  }

  let scanned = 0;
  let failing = 0;
  let truncated = false;
  const sample: { id: string; name: string }[] = [];

  for (let offset = 0; scanned < MAX_IMPACT_SCAN; offset += IMPACT_BATCH) {
    type Row = { id: string; name: string; values: Record<string, unknown> };
    let batch: Row[];
    if (stageRecordIds) {
      const slice = stageRecordIds.slice(offset, offset + IMPACT_BATCH);
      if (!slice.length) break;
      const { data } = await svc.from("data_records").select("id, name, values").eq("org_owner_id", org).in("id", slice).is("deleted_at", null);
      batch = (data ?? []) as Row[];
    } else {
      const { data } = await svc
        .from("data_records")
        .select("id, name, values")
        .eq("org_owner_id", org)
        .eq("object_id", objectId)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(offset, offset + IMPACT_BATCH - 1);
      batch = (data ?? []) as Row[];
    }
    if (!batch.length) break;

    for (const record of batch) {
      if (scanned >= MAX_IMPACT_SCAN) {
        truncated = true;
        break;
      }
      scanned++;
      const { formulaValues, ctx } = buildEvalContext(svc, org, attrs, record.values, record.name, { isNew: false }, actorUserId);
      const messages = await matchesRule(rule, attrsBySlug, schema, ctx, formulaValues, kind === "stage", false);
      if (messages.length) {
        failing++;
        if (sample.length < IMPACT_SAMPLE_SIZE) sample.push({ id: record.id, name: record.name });
      }
    }
    if (batch.length < IMPACT_BATCH) break;
  }

  return { ok: true, scanned, failing, sample, truncated };
}

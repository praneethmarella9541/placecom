import type { AttributeDef } from "./types";

/**
 * Validation rules: "when X, Y is required". Pure, so it can be tested and used by both the record
 * and the stage paths.
 *
 * A rule has an optional condition on one field and a list of requirements on fields. If the
 * condition holds (or there is none) and a requirement isn't met, the save is refused and the
 * messages say which fields. Existing records are not flagged; a rule is only checked on the next
 * save of a record.
 */

export type RuleOp = "eq" | "neq" | "empty" | "not_empty";
export type RuleCondition = { attribute: string; op: RuleOp; value?: string } | null;
/** "gte"/"lte" need `value` (a number, or a YYYY-MM-DD date) — the dropdown-only way to express
 *  "Package value must be at least 90000" without anyone writing a formula. */
export type RuleRequirement = { attribute: string; kind: "required" | "empty" | "gte" | "lte"; value?: string };

/**
 * `format` discriminates the two rule shapes a row can be (migration 0101): 'legacy' (condition +
 * requirements, everything above) or 'formula' (an expression compiled to expression_ast —
 * evaluated by lib/data-model/rule-engine-bridge.ts, never by anything in this file). Every formula
 * field is optional so existing code that only knows the legacy shape keeps compiling unchanged.
 */
export type Rule = {
  id: string;
  name: string;
  condition: RuleCondition;
  requirements: RuleRequirement[];
  format?: "legacy" | "formula";
  apiName?: string | null;
  description?: string | null;
  appliesOn?: "create" | "update" | "both";
  mode?: "block" | "warn";
  errorLocation?: string | null;
  message?: string | null;
  expressionSource?: string | null;
  expressionAst?: unknown;
  orderIndex?: number;
  adminBypass?: boolean;
  version?: number;
};

const SLUG = /^[a-z][a-z0-9_]{0,39}$/;
const OPS = new Set<RuleOp>(["eq", "neq", "empty", "not_empty"]);
export const MAX_REQUIREMENTS = 8;

/** A name or a stored value counts as empty when it is missing, blank, or an empty list. */
export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function valueMatches(stored: unknown, wanted: string): boolean {
  const want = wanted.trim().toLowerCase();
  const items = Array.isArray(stored) ? stored : [stored];
  return items.some((i) => String(i).trim().toLowerCase() === want);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "gte"/"lte" against a number when both sides parse as one, else a lexicographic string compare
 *  (what a YYYY-MM-DD date needs — sorts the same as time, same trick used elsewhere in this
 *  codebase for dates stored as ISO text). A blank stored value never meets either threshold. */
function meetsThreshold(stored: unknown, kind: "gte" | "lte", threshold: string | undefined): boolean {
  if (threshold === undefined) return true; // a malformed row should never be the reason a save fails
  if (isEmptyValue(stored)) return false;
  const storedNum = asNumber(stored);
  const thresholdNum = asNumber(threshold);
  if (storedNum !== null && thresholdNum !== null) return kind === "gte" ? storedNum >= thresholdNum : storedNum <= thresholdNum;
  const storedText = String(stored);
  return kind === "gte" ? storedText >= threshold : storedText <= threshold;
}

export function conditionHolds(cond: RuleCondition, values: Record<string, unknown>): boolean {
  if (!cond) return true;
  const v = values[cond.attribute];
  switch (cond.op) {
    case "empty":
      return isEmptyValue(v);
    case "not_empty":
      return !isEmptyValue(v);
    case "eq":
      return !isEmptyValue(v) && valueMatches(v, cond.value ?? "");
    case "neq":
      return isEmptyValue(v) || !valueMatches(v, cond.value ?? "");
  }
}

/** The requirement messages that fail for these values (empty list = all met). `name` is the record's name. */
export function failedRequirements(
  rule: Pick<Rule, "name" | "requirements">,
  attrs: AttributeDef[],
  values: Record<string, unknown>,
  name?: string
): string[] {
  const out: string[] = [];
  for (const req of rule.requirements) {
    const attr = attrs.find((a) => a.slug === req.attribute);
    const label = attr?.name ?? (req.attribute === "name" ? "Name" : req.attribute);
    const v = req.attribute === "name" ? name : values[req.attribute];
    if (req.kind === "required" && isEmptyValue(v)) out.push(`${rule.name}: ${label} is required.`);
    if (req.kind === "empty" && !isEmptyValue(v)) out.push(`${rule.name}: ${label} must be empty.`);
    if ((req.kind === "gte" || req.kind === "lte") && !meetsThreshold(v, req.kind, req.value)) {
      out.push(`${rule.name}: ${label} must be ${req.kind === "gte" ? "at least" : "at most"} ${req.value}.`);
    }
  }
  return out;
}

/** Record rules against the values a record would have after the save. */
export function checkRecordRules(rules: Rule[], attrs: AttributeDef[], values: Record<string, unknown>, name?: string): string[] {
  return rules.flatMap((r) => (conditionHolds(r.condition, values) ? failedRequirements(r, attrs, values, name) : []));
}

/**
 * The attribute slugs a "required" requirement is blocking on, deduped — not a message, a field to
 * ask for. Used to build the board's "fill these in" dialog on a blocked stage move, instead of just
 * showing an error and reverting the card. Only legacy-shaped rules have a requirement to point at;
 * a formula rule's equivalent is its own error_location, handled by the caller.
 */
export function missingRequiredFields(rules: Rule[], values: Record<string, unknown>, name?: string): string[] {
  const out = new Set<string>();
  for (const rule of rules) {
    if (rule.format === "formula") continue;
    if (!conditionHolds(rule.condition, values)) continue;
    for (const req of rule.requirements) {
      const v = req.attribute === "name" ? name : values[req.attribute];
      if (req.kind === "required" && isEmptyValue(v)) out.add(req.attribute);
      if ((req.kind === "gte" || req.kind === "lte") && !meetsThreshold(v, req.kind, req.value)) out.add(req.attribute);
    }
  }
  return [...out];
}

/** Check the shape of a rule from the API. Slugs are only checked for form; the screens offer real ones. */
export function sanitizeRule(raw: unknown): { ok: true; condition: RuleCondition; requirements: RuleRequirement[] } | { ok: false; error: string } {
  const input = (raw ?? {}) as { condition?: unknown; requirements?: unknown };

  let condition: RuleCondition = null;
  if (input.condition !== undefined && input.condition !== null) {
    const c = input.condition as { attribute?: unknown; op?: unknown; value?: unknown };
    if (typeof c.attribute !== "string" || !SLUG.test(c.attribute) || !OPS.has(c.op as RuleOp)) return { ok: false, error: "The condition isn't valid." };
    const needs = c.op === "eq" || c.op === "neq";
    if (needs && (typeof c.value !== "string" || !c.value.trim() || c.value.length > 200)) return { ok: false, error: "The condition needs a value." };
    condition = { attribute: c.attribute, op: c.op as RuleOp, value: needs ? (c.value as string).trim() : undefined };
  }

  if (!Array.isArray(input.requirements) || input.requirements.length === 0 || input.requirements.length > MAX_REQUIREMENTS) {
    return { ok: false, error: `A rule needs between 1 and ${MAX_REQUIREMENTS} requirements.` };
  }
  const requirements: RuleRequirement[] = [];
  for (const r of input.requirements as { attribute?: unknown; kind?: unknown; value?: unknown }[]) {
    if (!r || typeof r.attribute !== "string" || !(SLUG.test(r.attribute) || r.attribute === "name")) return { ok: false, error: "A requirement isn't valid." };
    if (r.kind === "required" || r.kind === "empty") {
      requirements.push({ attribute: r.attribute, kind: r.kind });
    } else if (r.kind === "gte" || r.kind === "lte") {
      const value = typeof r.value === "string" ? r.value.trim().slice(0, 60) : "";
      const isNumber = value !== "" && Number.isFinite(Number(value.replace(/,/g, "")));
      const isDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
      if (!isNumber && !isDate) return { ok: false, error: "A threshold needs a number, or a date like 2026-12-31." };
      requirements.push({ attribute: r.attribute, kind: r.kind, value });
    } else {
      return { ok: false, error: "A requirement isn't valid." };
    }
  }
  return { ok: true, condition, requirements };
}

/** Fill the default of every field the input left out. Archived fields are skipped. */
export function applyDefaults(attrs: AttributeDef[], values: Record<string, unknown>): Record<string, unknown> {
  const out = { ...values };
  for (const a of attrs) {
    if (a.archived_at) continue;
    const d = a.config.default;
    if (d !== undefined && d !== null && out[a.slug] === undefined) out[a.slug] = d;
  }
  return out;
}

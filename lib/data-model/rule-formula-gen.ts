import type { FormulaValue } from "../rules-engine/index";
import type { RuleCondition, RuleRequirement } from "./rules";
import type { AttributeDef } from "./types";

/**
 * Generates a lib/rules-engine formula equivalent to one legacy condition+requirement
 * (lib/data-model/rules.ts), so rule-engine-bridge.ts can run either evaluator over the same stored
 * rule. Pure — no database, no "server-only" — so this is the part of the bridge the
 * migration-equivalence tests exercise directly, without needing a Supabase client at all.
 *
 * Every legacy rule becomes one small formula PER REQUIREMENT (not one formula for the whole rule),
 * so a failing requirement's message stays exactly what it always was, generated the same way, not
 * encoded into the formula itself.
 */

function fieldRef(attribute: string): string {
  return attribute === "name" ? "Name" : attribute;
}

function quote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Case-insensitive, trimmed match — identical to rules.ts's valueMatches(), expressed as a formula. */
function matchesFormula(attribute: string, attrsBySlug: Map<string, AttributeDef>, value: string): string {
  const ref = fieldRef(attribute);
  const attr = attrsBySlug.get(attribute);
  const isMulti = !!attr && (attr.is_multi || attr.type === "multi_select");
  return isMulti ? `INCLUDES(${ref}, ${quote(value)})` : `LOWER(TRIM(TEXT(${ref}))) = LOWER(TRIM(${quote(value)}))`;
}

/**
 * Identical to rules.ts's conditionHolds(), expressed as a formula — including its one quirk: that
 * function reads `values[cond.attribute]`, and a record's name is never a key inside `values` (it's
 * the record's own `name` column, not one of its attributes), so a condition on "name" always reads
 * as blank there, regardless of the record's actual name. failedRequirements() doesn't have this
 * problem (it special-cases "name" correctly), so this only affects a rule whose CONDITION, not its
 * requirement, is on "name" — rare, but a real stored rule could have one, and bit-for-bit migration
 * equivalence means reproducing this, not quietly fixing it on the way through. Worth fixing openly
 * in a later phase, visibly, not as a side effect of swapping the evaluator underneath.
 */
export function conditionToFormula(cond: RuleCondition, attrsBySlug: Map<string, AttributeDef>): string {
  if (!cond) return "TRUE";
  if (cond.attribute === "name") {
    return cond.op === "empty" || cond.op === "neq" ? "TRUE" : "FALSE";
  }
  const ref = fieldRef(cond.attribute);
  switch (cond.op) {
    case "empty":
      return `ISBLANK(${ref})`;
    case "not_empty":
      return `NOT(ISBLANK(${ref}))`;
    case "eq":
      return `AND(NOT(ISBLANK(${ref})), ${matchesFormula(cond.attribute, attrsBySlug, cond.value ?? "")})`;
    case "neq":
      return `OR(ISBLANK(${ref}), NOT(${matchesFormula(cond.attribute, attrsBySlug, cond.value ?? "")}))`;
  }
}

/** The error-condition formula for one requirement: TRUE means this requirement has failed. */
export function requirementErrorFormula(condition: RuleCondition, req: RuleRequirement, attrsBySlug: Map<string, AttributeDef>): string {
  const condFormula = conditionToFormula(condition, attrsBySlug);
  const reqFormula = `ISBLANK(${fieldRef(req.attribute)})`;
  const failed = req.kind === "required" ? reqFormula : `NOT(${reqFormula})`;
  return condFormula === "TRUE" ? failed : `AND(${condFormula}, ${failed})`;
}

/** Whether a formula rule's "applies on" setting matches this save. A rule with no setting (or
 *  "both") always matches; a stage rule has no create/update distinction, so its caller never asks. */
export function appliesOnMatches(appliesOn: "create" | "update" | "both" | undefined, isNew: boolean): boolean {
  if (!appliesOn || appliesOn === "both") return true;
  return appliesOn === "create" ? isNew : !isNew;
}

const MESSAGE_VAR = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Substitutes `{{field}}` references in a formula rule's custom message with the record's own
 *  values at the time it failed (§3.12). An unknown or blank reference renders as empty text rather
 *  than leaving the literal `{{...}}` in front of the person reading the error. */
export function renderMessage(template: string, values: Record<string, FormulaValue>): string {
  return template.replace(MESSAGE_VAR, (_m, slug: string) => {
    const v = values[slug];
    if (v === undefined || v === null) return "";
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  });
}

/** Exactly rules.ts's failedRequirements() message text, so a workspace sees no difference when it opts in. */
export function requirementMessage(ruleName: string, req: RuleRequirement, attrsBySlug: Map<string, AttributeDef>): string {
  const attr = attrsBySlug.get(req.attribute);
  const label = attr?.name ?? (req.attribute === "name" ? "Name" : req.attribute);
  return req.kind === "required" ? `${ruleName}: ${label} is required.` : `${ruleName}: ${label} must be empty.`;
}

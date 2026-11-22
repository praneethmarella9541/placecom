import { test } from "node:test";
import assert from "node:assert/strict";
import { compileExpression, runExpression, type EvalContext, type ObjectSchema } from "../rules-engine/index.ts";
import { appliesOnMatches, conditionToFormula, renderMessage, requirementErrorFormula, requirementMessage } from "./rule-formula-gen.ts";
import { checkRecordRules, failedRequirements, type Rule, type RuleCondition, type RuleRequirement } from "./rules.ts";
import { valuesToFormula } from "./rule-values.ts";
import type { AttributeDef } from "./types.ts";

/**
 * Migration-equivalence proof (required by the rules-engine plan, phase 2): for the SAME legacy
 * rule and the SAME record, the formula generated here must evaluate to exactly the error the old
 * evaluator (lib/data-model/rules.ts) would have reported — same requirements failing, same
 * messages, same order. Fuzzed across attribute types, conditions and requirement shapes with a
 * deterministic seed so a failure is reproducible.
 */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const attr = (over: Partial<AttributeDef> & Pick<AttributeDef, "slug" | "type">): AttributeDef => ({
  name: over.slug,
  is_multi: false,
  config: {},
  is_required: false,
  is_unique: false,
  ...over,
});

const ATTRS: AttributeDef[] = [
  attr({ slug: "title", type: "text" }),
  attr({ slug: "amount", type: "number" }),
  attr({ slug: "active", type: "checkbox" }),
  attr({ slug: "stage", type: "select", config: { options: ["Enquiry", "Booked", "Cancelled"] } }),
  attr({ slug: "tags", type: "multi_select", config: { options: ["A", "B", "C"] } }),
];

const SCHEMA: ObjectSchema = {
  Name: { type: "text" },
  title: { type: "text" },
  amount: { type: "number" },
  active: { type: "boolean" },
  stage: { type: "text" },
  tags: { type: "text", isMulti: true },
};

const ATTR_SLUGS = ["name", "title", "amount", "active", "stage", "tags"];

function ctxFor(values: Record<string, unknown>, name: string | undefined): EvalContext {
  return {
    values: valuesToFormula(ATTRS, values, name),
    isNew: false,
    user: { id: "u1", role: "staff", groupName: null, email: "", emailDomain: "" },
    workspace: { id: "w1", name: "" },
    now: new Date(),
    timeZone: "Asia/Kolkata",
    resolveLink: () => null,
  };
}

async function newEngineErrors(rule: Rule, values: Record<string, unknown>, name: string | undefined): Promise<string[]> {
  const attrsBySlug = new Map(ATTRS.map((a) => [a.slug, a]));
  const ctx = ctxFor(values, name);
  const out: string[] = [];
  for (const req of rule.requirements) {
    const source = requirementErrorFormula(rule.condition, req, attrsBySlug);
    const compiled = compileExpression(source, SCHEMA);
    assert.ok(compiled.ok, `generated formula failed to compile: ${compiled.ok ? "" : compiled.error} <- ${source}`);
    if (!compiled.ok) continue;
    const result = await runExpression(compiled.ast, SCHEMA, ctx);
    assert.ok(result.ok, `generated formula failed to evaluate: ${result.ok ? "" : result.error} <- ${source}`);
    if (result.ok && result.value === true) out.push(requirementMessage(rule.name, req, attrsBySlug));
  }
  return out;
}

function randomCondition(rand: () => number): RuleCondition {
  if (rand() < 0.3) return null;
  const attribute = ATTR_SLUGS[Math.floor(rand() * ATTR_SLUGS.length)];
  const op = (["eq", "neq", "empty", "not_empty"] as const)[Math.floor(rand() * 4)];
  const value = op === "eq" || op === "neq" ? ["Enquiry", "Booked", "Cancelled", "A", "B", "x", "42", "true", "", "  Booked  "][Math.floor(rand() * 10)] : undefined;
  return { attribute, op, value };
}

function randomRequirement(rand: () => number): RuleRequirement {
  // gte/lte only ever target "amount" (a number field) — that's all the UI offers thresholds for
  // besides date fields, which this fuzzer's ATTRS doesn't include (covered by a dedicated test below).
  if (rand() < 0.3) {
    const kind = rand() < 0.5 ? "gte" : "lte";
    const value = String([-10, 0, 1, 5, 42, 100][Math.floor(rand() * 6)]);
    return { attribute: "amount", kind, value };
  }
  const attribute = ATTR_SLUGS[Math.floor(rand() * ATTR_SLUGS.length)];
  const kind = rand() < 0.5 ? "required" : "empty";
  return { attribute, kind };
}

function randomValues(rand: () => number): { values: Record<string, unknown>; name?: string } {
  const values: Record<string, unknown> = {};
  if (rand() < 0.8) values.title = ["", "  ", "hello", "Hello World"][Math.floor(rand() * 4)];
  if (rand() < 0.8) values.amount = [0, 1, 42, -5][Math.floor(rand() * 4)];
  if (rand() < 0.8) values.active = rand() < 0.5;
  if (rand() < 0.8) values.stage = ["Enquiry", "Booked", "Cancelled"][Math.floor(rand() * 3)];
  if (rand() < 0.8) values.tags = [[], ["A"], ["A", "B"], ["C"]][Math.floor(rand() * 4)];
  const name = rand() < 0.9 ? ["", "Acme Trip", "  "][Math.floor(rand() * 3)] : undefined;
  return { values, name };
}

const SEED = 20261121;
const ITERATIONS = 2000;

test("the new engine reproduces the legacy evaluator's messages, requirement by requirement, across randomized rules and records", async () => {
  const rand = mulberry32(SEED);
  for (let i = 0; i < ITERATIONS; i++) {
    const condition = randomCondition(rand);
    const req = randomRequirement(rand);
    const { values, name } = randomValues(rand);
    const rule: Rule = { id: "r1", name: "Rule", condition, requirements: [req] };

    const legacy = checkRecordRules([rule], ATTRS, values, name);
    const fresh = await newEngineErrors(rule, values, name);

    assert.deepEqual(
      fresh,
      legacy,
      `seed ${SEED} iter ${i}: mismatch\n  condition=${JSON.stringify(condition)}\n  req=${JSON.stringify(req)}\n  values=${JSON.stringify(values)} name=${JSON.stringify(name)}\n  legacy=${JSON.stringify(legacy)}\n  fresh=${JSON.stringify(fresh)}`
    );
  }
});

test("a rule with several requirements reports them in the same order as the legacy evaluator", async () => {
  const rand = mulberry32(SEED + 1);
  for (let i = 0; i < 300; i++) {
    const condition = randomCondition(rand);
    const requirements = [randomRequirement(rand), randomRequirement(rand), randomRequirement(rand)];
    const { values, name } = randomValues(rand);
    const rule: Rule = { id: "r1", name: "Multi", condition, requirements };

    const legacy = checkRecordRules([rule], ATTRS, values, name);
    const attrsBySlug = new Map(ATTRS.map((a) => [a.slug, a]));
    const ctx = ctxFor(values, name);
    const fresh: string[] = [];
    for (const r of requirements) {
      const source = requirementErrorFormula(condition, r, attrsBySlug);
      const compiled = compileExpression(source, SCHEMA);
      if (!compiled.ok) continue;
      const result = await runExpression(compiled.ast, SCHEMA, ctx);
      if (result.ok && result.value === true) fresh.push(requirementMessage(rule.name, r, attrsBySlug));
    }
    assert.deepEqual(fresh, legacy, `seed ${SEED + 1} iter ${i}`);
  }
});

test("stage rules (failedRequirements with no condition) match too", async () => {
  const rand = mulberry32(SEED + 2);
  for (let i = 0; i < 500; i++) {
    const req = randomRequirement(rand);
    const { values, name } = randomValues(rand);
    const rule: Rule = { id: "r1", name: "Stage rule", condition: null, requirements: [req] };

    const legacy = failedRequirements(rule, ATTRS, values, name);
    const fresh = await newEngineErrors(rule, values, name);
    assert.deepEqual(fresh, legacy, `seed ${SEED + 2} iter ${i}`);
  }
});

test("requirementErrorFormula builds DATE(y, m, d) for an at-least/at-most threshold on a date field", async () => {
  const dateAttrs: AttributeDef[] = [attr({ slug: "deadline", type: "date" })];
  const dateSchema: ObjectSchema = { Name: { type: "text" }, deadline: { type: "date" } };
  const attrsBySlug = new Map(dateAttrs.map((a) => [a.slug, a]));
  const req: RuleRequirement = { attribute: "deadline", kind: "gte", value: "2026-01-15" };
  const source = requirementErrorFormula(null, req, attrsBySlug);
  assert.match(source, /DATE\(2026, 1, 15\)/);
  const compiled = compileExpression(source, dateSchema);
  assert.equal(compiled.ok, true);
  if (!compiled.ok) return;

  const ctx = (deadline: string | null): EvalContext => ({
    values: { deadline: deadline ? new Date(`${deadline}T00:00:00.000Z`) : null },
    isNew: false,
    user: { id: "u1", role: "staff", groupName: null, email: "", emailDomain: "" },
    workspace: { id: "w1", name: "" },
    now: new Date(),
    timeZone: "Asia/Kolkata",
    resolveLink: () => null,
  });

  const before = await runExpression(compiled.ast, dateSchema, ctx("2025-12-01"));
  assert.deepEqual(before, { ok: true, value: true, type: "boolean" }); // too early: requirement failed
  const after = await runExpression(compiled.ast, dateSchema, ctx("2026-06-15"));
  assert.deepEqual(after, { ok: true, value: false, type: "boolean" }); // on/after the threshold: met
  const blank = await runExpression(compiled.ast, dateSchema, ctx(null));
  assert.deepEqual(blank, { ok: true, value: true, type: "boolean" }); // blank never meets a minimum
});

test('a condition on "name" reproduces the legacy evaluator\'s blank-name quirk, not the real name', async () => {
  // conditionHolds() reads values[cond.attribute], and a record's name is never a key inside
  // `values` — so a condition on "name" always reads as blank there, whatever the record is
  // actually named. Bit-for-bit migration equivalence means matching that, not fixing it here.
  const rule = (op: "empty" | "not_empty" | "eq" | "neq"): Rule => ({
    id: "r1",
    name: "Rule",
    condition: { attribute: "name", op, value: op === "eq" || op === "neq" ? "Acme Trip" : undefined },
    requirements: [{ attribute: "amount", kind: "required" }],
  });
  const values = {};
  const name = "Acme Trip"; // a real, non-blank name
  for (const op of ["empty", "not_empty", "eq", "neq"] as const) {
    const legacy = checkRecordRules([rule(op)], ATTRS, values, name);
    const fresh = await newEngineErrors(rule(op), values, name);
    assert.deepEqual(fresh, legacy, `op=${op}`);
  }
  // Concretely: "empty" and "neq" always hold (so amount's requirement is checked and fails);
  // "not_empty" and "eq" never hold (so the requirement is skipped) — regardless of the real name.
  assert.deepEqual(await newEngineErrors(rule("empty"), values, name), ["Rule: amount is required."]);
  assert.deepEqual(await newEngineErrors(rule("not_empty"), values, name), []);
});

test("renderMessage substitutes {{field}} references from the record's values", () => {
  assert.equal(renderMessage("{{title}} must be set", { title: "Hello" }), "Hello must be set");
  assert.equal(renderMessage("Amount is {{amount}}", { amount: 42 }), "Amount is 42");
  assert.equal(renderMessage("{{flag}}", { flag: true }), "true");
  assert.equal(renderMessage("Tags: {{tags}}", { tags: ["A", "B"] }), "Tags: A, B");
  assert.equal(renderMessage("Start: {{start}}", { start: new Date(Date.UTC(2026, 11, 31)) }), "Start: 2026-12-31");
  assert.equal(renderMessage("Missing: {{nope}}", {}), "Missing: ");
  assert.equal(renderMessage("No vars here", { title: "x" }), "No vars here");
});

test("appliesOnMatches gates a formula rule by create/update, defaulting to always", () => {
  assert.equal(appliesOnMatches(undefined, true), true);
  assert.equal(appliesOnMatches(undefined, false), true);
  assert.equal(appliesOnMatches("both", true), true);
  assert.equal(appliesOnMatches("both", false), true);
  assert.equal(appliesOnMatches("create", true), true);
  assert.equal(appliesOnMatches("create", false), false);
  assert.equal(appliesOnMatches("update", true), false);
  assert.equal(appliesOnMatches("update", false), true);
});

test("conditionToFormula renders the four legacy operators distinctly", () => {
  const attrsBySlug = new Map(ATTRS.map((a) => [a.slug, a]));
  assert.equal(conditionToFormula(null, attrsBySlug), "TRUE");
  assert.match(conditionToFormula({ attribute: "stage", op: "empty" }, attrsBySlug), /ISBLANK/);
  assert.match(conditionToFormula({ attribute: "stage", op: "not_empty" }, attrsBySlug), /NOT\(ISBLANK/);
  assert.match(conditionToFormula({ attribute: "stage", op: "eq", value: "Booked" }, attrsBySlug), /LOWER\(TRIM/);
  assert.match(conditionToFormula({ attribute: "tags", op: "eq", value: "A" }, attrsBySlug), /INCLUDES/);
});

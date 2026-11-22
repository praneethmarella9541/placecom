import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStaticFormulaSchema, compileConditionFormula, flattenRuntimeData, variablePathToSlug } from "./condition-formula.ts";
import { runExpression } from "../rules-engine/index.ts";
import type { EvalContext } from "../rules-engine/index.ts";

const ctxFor = (values: Record<string, unknown>): EvalContext => ({
  values: values as EvalContext["values"],
  isNew: true,
  user: { id: "u1", role: "staff", groupName: null, email: "", emailDomain: "" },
  workspace: { id: "org", name: "" },
  now: new Date(),
  timeZone: "Asia/Kolkata",
  resolveLink: async () => null,
});

test("variablePathToSlug turns a dotted path into a formula-safe identifier", () => {
  assert.equal(variablePathToSlug("trigger.record.values.score"), "trigger_record_values_score");
  assert.equal(variablePathToSlug("b1.record.id"), "b1_record_id");
  assert.equal(variablePathToSlug("9lives"), "_9lives");
});

test("buildStaticFormulaSchema offers every variable as an 'any' field", () => {
  const schema = buildStaticFormulaSchema([{ path: "trigger.record.values.score", label: "x" }, { path: "trigger.event.outcome", label: "y" }]);
  assert.deepEqual(schema, { trigger_record_values_score: { type: "any" }, trigger_event_outcome: { type: "any" } });
});

test("compileConditionFormula insists the formula resolves to TRUE/FALSE", () => {
  const schema = buildStaticFormulaSchema([{ path: "trigger.record.values.score", label: "x" }]);
  assert.equal(compileConditionFormula("trigger_record_values_score > 90", schema).ok, true);
  const text = compileConditionFormula('"hi"', schema);
  assert.equal(text.ok, false);
  assert.equal(compileConditionFormula("nope > 1", schema).ok, false); // unknown field
});

test("flattenRuntimeData reads real run data into flat slugs, nothing fails on an absent optional path", async () => {
  const data = { trigger: { record: { id: "r1", name: "Ana", values: { score: 95, status: "Won" } }, event: { actor_kind: "user" } }, b1: { found: 3 } };
  const { schema, values } = flattenRuntimeData(data);
  assert.equal(values.trigger_record_values_score, 95);
  assert.equal(values.trigger_record_values_status, "Won");
  assert.equal(values.b1_found, 3);

  const compiled = compileConditionFormula('AND(trigger_record_values_score > 90, trigger_record_values_status = "Won")', schema);
  assert.equal(compiled.ok, true);
  if (compiled.ok) {
    const result = await runExpression(compiled.ast, schema, ctxFor(values));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value, true);
  }
});

test("flattenRuntimeData never walks into the prototype chain", () => {
  const { schema } = flattenRuntimeData({ a: 1 });
  assert.equal(Object.hasOwn(schema, "__proto__"), false);
  assert.equal(Object.hasOwn(schema, "constructor"), false);
});

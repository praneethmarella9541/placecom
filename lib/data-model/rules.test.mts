import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDefaults, checkRecordRules, conditionHolds, failedRequirements, missingRequiredFields, sanitizeRule } from "./rules.ts";
import type { AttributeDef } from "./types";

const attr = (slug: string, name: string, over: Partial<AttributeDef> = {}): AttributeDef => ({ slug, name, type: "text", is_multi: false, config: {}, is_required: false, is_unique: false, ...over });
const attrs = [attr("value", "Deal value", { type: "currency" }), attr("status", "Status", { type: "select" }), attr("lost_reason", "Lost reason")];

test("a condition on a field", () => {
  assert.equal(conditionHolds(null, {}), true);
  assert.equal(conditionHolds({ attribute: "status", op: "eq", value: "won" }, { status: "Won" }), true);
  assert.equal(conditionHolds({ attribute: "status", op: "eq", value: "Won" }, {}), false);
  assert.equal(conditionHolds({ attribute: "status", op: "neq", value: "Won" }, {}), true);
  assert.equal(conditionHolds({ attribute: "status", op: "empty" }, { status: "  " }), true);
  assert.equal(conditionHolds({ attribute: "tags", op: "eq", value: "b" }, { tags: ["a", "B"] }), true);
});

test("requirements: required and must-be-empty", () => {
  const rule = { name: "Won needs a value", requirements: [{ attribute: "value", kind: "required" as const }, { attribute: "lost_reason", kind: "empty" as const }] };
  assert.deepEqual(failedRequirements(rule, attrs, { value: 5000 }), []);
  assert.deepEqual(failedRequirements(rule, attrs, { lost_reason: "x" }), ["Won needs a value: Deal value is required.", "Won needs a value: Lost reason must be empty."]);
  assert.deepEqual(failedRequirements({ name: "n", requirements: [{ attribute: "name", kind: "required" }] }, attrs, {}, ""), ["n: Name is required."]);
});

test("zero is a real value, not empty", () => {
  assert.deepEqual(failedRequirements({ name: "r", requirements: [{ attribute: "value", kind: "required" }] }, attrs, { value: 0 }), []);
});

test("requirements: at-least and at-most thresholds, numeric and date, blank always fails", () => {
  const minValue = { name: "Minimum value", requirements: [{ attribute: "value", kind: "gte" as const, value: "90000" }] };
  assert.deepEqual(failedRequirements(minValue, attrs, { value: 90000 }), []);
  assert.deepEqual(failedRequirements(minValue, attrs, { value: "1,20,000" }), []); // comma-formatted numeric text
  assert.deepEqual(failedRequirements(minValue, attrs, { value: 50000 }), ["Minimum value: Deal value must be at least 90000."]);
  assert.deepEqual(failedRequirements(minValue, attrs, {}), ["Minimum value: Deal value must be at least 90000."]); // blank never meets a minimum

  const maxValue = { name: "Maximum value", requirements: [{ attribute: "value", kind: "lte" as const, value: "90000" }] };
  assert.deepEqual(failedRequirements(maxValue, attrs, { value: 90000 }), []);
  assert.deepEqual(failedRequirements(maxValue, attrs, { value: 95000 }), ["Maximum value: Deal value must be at most 90000."]);

  const dateAttrs = [attr("deadline", "Deadline", { type: "date" })];
  const minDate = { name: "Not too early", requirements: [{ attribute: "deadline", kind: "gte" as const, value: "2026-01-01" }] };
  assert.deepEqual(failedRequirements(minDate, dateAttrs, { deadline: "2026-06-15" }), []);
  assert.deepEqual(failedRequirements(minDate, dateAttrs, { deadline: "2025-12-01" }), ["Not too early: Deadline must be at least 2026-01-01."]);
});

test("a record rule only bites when its condition holds", () => {
  const rule = { id: "1", name: "Won needs a value", condition: { attribute: "status", op: "eq" as const, value: "Won" }, requirements: [{ attribute: "value", kind: "required" as const }] };
  assert.deepEqual(checkRecordRules([rule], attrs, { status: "Open" }), []);
  assert.deepEqual(checkRecordRules([rule], attrs, { status: "Won" }), ["Won needs a value: Deal value is required."]);
  assert.deepEqual(checkRecordRules([rule], attrs, { status: "Won", value: 10 }), []);
});

test("sanitizeRule checks shape", () => {
  assert.equal(sanitizeRule({ requirements: [{ attribute: "value", kind: "required" }] }).ok, true);
  assert.equal(sanitizeRule({ condition: { attribute: "status", op: "eq", value: "Won" }, requirements: [{ attribute: "name", kind: "required" }] }).ok, true);
  assert.equal(sanitizeRule({ requirements: [] }).ok, false);
  assert.equal(sanitizeRule({ requirements: [{ attribute: "Bad Slug", kind: "required" }] }).ok, false);
  assert.equal(sanitizeRule({ requirements: [{ attribute: "value", kind: "maybe" }] }).ok, false);
  assert.equal(sanitizeRule({ condition: { attribute: "x", op: "eq" }, requirements: [{ attribute: "value", kind: "required" }] }).ok, false);
  assert.equal(sanitizeRule({ requirements: [{ attribute: "value", kind: "gte" }] }).ok, false); // needs a value
  assert.equal(sanitizeRule({ requirements: [{ attribute: "value", kind: "gte", value: "not a number" }] }).ok, false);
  const gte = sanitizeRule({ requirements: [{ attribute: "value", kind: "gte", value: "90000" }] });
  assert.equal(gte.ok, true);
  if (gte.ok) assert.deepEqual(gte.requirements, [{ attribute: "value", kind: "gte", value: "90000" }]);
  assert.equal(sanitizeRule({ requirements: [{ attribute: "deadline", kind: "lte", value: "2026-12-31" }] }).ok, true);
});

test("missingRequiredFields names the fields a \"required\" requirement is blocking on, deduped", () => {
  const needsValue = { id: "1", name: "Won needs a value", condition: null, requirements: [{ attribute: "value", kind: "required" as const }] };
  const needsBoth = { id: "2", name: "Also needs status", condition: null, requirements: [{ attribute: "value", kind: "required" as const }, { attribute: "status", kind: "required" as const }] };
  assert.deepEqual(missingRequiredFields([needsValue, needsBoth], {}), ["value", "status"]);
  assert.deepEqual(missingRequiredFields([needsValue, needsBoth], { value: 10, status: "Won" }), []);
});

test("missingRequiredFields respects the rule's condition and \"must be empty\" requirements don't count", () => {
  const gated = { id: "1", name: "Won needs a value", condition: { attribute: "status", op: "eq" as const, value: "Won" }, requirements: [{ attribute: "value", kind: "required" as const }] };
  assert.deepEqual(missingRequiredFields([gated], { status: "Open" }), []); // condition doesn't hold
  assert.deepEqual(missingRequiredFields([gated], { status: "Won" }), ["value"]);
  const mustBeEmpty = { id: "2", name: "n", condition: null, requirements: [{ attribute: "lost_reason", kind: "empty" as const }] };
  assert.deepEqual(missingRequiredFields([mustBeEmpty], { lost_reason: "x" }), []); // not a "required" kind
});

test("missingRequiredFields also names a field a failing at-least/at-most threshold is blocking on", () => {
  const minValue = { id: "1", name: "Minimum value", condition: null, requirements: [{ attribute: "value", kind: "gte" as const, value: "90000" }] };
  assert.deepEqual(missingRequiredFields([minValue], { value: 50000 }), ["value"]);
  assert.deepEqual(missingRequiredFields([minValue], { value: 95000 }), []);
});

test("missingRequiredFields skips formula-format rules — they have no single field to point at", () => {
  const formula = { id: "1", name: "n", condition: null, requirements: [], format: "formula" as const };
  assert.deepEqual(missingRequiredFields([formula], {}), []);
});

test("defaults fill only what is missing, and skip archived fields", () => {
  const withDefaults = [attr("status", "Status", { config: { default: "Open" } }), attr("tier", "Tier", { config: { default: "B" } }), attr("old", "Old", { config: { default: "x" }, archived_at: "2026-01-01" })];
  assert.deepEqual(applyDefaults(withDefaults, { tier: "A" }), { status: "Open", tier: "A" });
});

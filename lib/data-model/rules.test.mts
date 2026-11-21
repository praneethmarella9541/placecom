import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDefaults, checkRecordRules, conditionHolds, failedRequirements, sanitizeRule } from "./rules.ts";
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
});

test("defaults fill only what is missing, and skip archived fields", () => {
  const withDefaults = [attr("status", "Status", { config: { default: "Open" } }), attr("tier", "Tier", { config: { default: "B" } }), attr("old", "Old", { config: { default: "x" }, archived_at: "2026-01-01" })];
  assert.deepEqual(applyDefaults(withDefaults, { tier: "A" }), { status: "Open", tier: "A" });
});

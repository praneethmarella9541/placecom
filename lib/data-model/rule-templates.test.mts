import { test } from "node:test";
import assert from "node:assert/strict";
import { RULE_TEMPLATES, findRuleTemplate } from "./rule-templates.ts";

test("every template has an id, label, description, formula and message within the column limits", () => {
  const ids = new Set<string>();
  for (const t of RULE_TEMPLATES) {
    assert.ok(t.id && /^[a-z][a-z0-9_]*$/.test(t.id), `bad id: ${t.id}`);
    assert.ok(!ids.has(t.id), `duplicate id: ${t.id}`);
    ids.add(t.id);
    assert.ok(t.label.trim().length > 0 && t.label.length <= 100);
    assert.ok(t.description.trim().length > 0);
    assert.ok(t.expressionSource.trim().length > 0 && t.expressionSource.length <= 4000);
    assert.ok(t.message.trim().length > 0 && t.message.length <= 500);
    assert.ok(t.mode === "block" || t.mode === "warn");
  }
});

test("findRuleTemplate looks up by id and returns undefined for an unknown one", () => {
  assert.equal(findRuleTemplate("date_order")?.label, "End date can't be before start date");
  assert.equal(findRuleTemplate("nope"), undefined);
});

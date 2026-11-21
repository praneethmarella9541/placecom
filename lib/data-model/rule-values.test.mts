import { test } from "node:test";
import assert from "node:assert/strict";
import { valuesToFormula } from "./rule-values.ts";
import type { AttributeDef } from "./types.ts";

const attr = (over: Partial<AttributeDef> & Pick<AttributeDef, "slug" | "type">): AttributeDef => ({
  name: over.slug,
  is_multi: false,
  config: {},
  is_required: false,
  is_unique: false,
  ...over,
});

test("Name is always present, from the `name` argument", () => {
  assert.equal(valuesToFormula([], {}, "Acme").Name, "Acme");
  assert.equal(valuesToFormula([], {}, undefined).Name, "");
});

test("text, number, boolean values pass through as-is", () => {
  const attrs = [attr({ slug: "title", type: "text" }), attr({ slug: "amount", type: "number" }), attr({ slug: "active", type: "checkbox" })];
  const out = valuesToFormula(attrs, { title: "Hi", amount: 42, active: true });
  assert.equal(out.title, "Hi");
  assert.equal(out.amount, 42);
  assert.equal(out.active, true);
});

test("a date string becomes a UTC-midnight Date", () => {
  const attrs = [attr({ slug: "start_date", type: "date" })];
  const out = valuesToFormula(attrs, { start_date: "2026-12-31" });
  assert.ok(out.start_date instanceof Date);
  assert.equal((out.start_date as Date).toISOString().slice(0, 10), "2026-12-31");
});

test("a timestamp string becomes a Date preserving the instant", () => {
  const attrs = [attr({ slug: "sent_at", type: "timestamp" })];
  const out = valuesToFormula(attrs, { sent_at: "2026-01-02T03:04:05.000Z" });
  assert.ok(out.sent_at instanceof Date);
  assert.equal((out.sent_at as Date).toISOString(), "2026-01-02T03:04:05.000Z");
});

test("an unparsable date or timestamp becomes null rather than an Invalid Date", () => {
  const attrs = [attr({ slug: "start_date", type: "date" })];
  const out = valuesToFormula(attrs, { start_date: "not a date" });
  assert.equal(out.start_date, null);
});

test("a multi-value field's array is kept as string[], non-strings dropped", () => {
  const attrs = [attr({ slug: "tags", type: "text", is_multi: true })];
  const out = valuesToFormula(attrs, { tags: ["a", "b", 5, null] });
  assert.deepEqual(out.tags, ["a", "b"]);
});

test("multi_select is multi-valued even without is_multi set", () => {
  const attrs = [attr({ slug: "destinations", type: "multi_select" })];
  const out = valuesToFormula(attrs, { destinations: ["Goa"] });
  assert.deepEqual(out.destinations, ["Goa"]);
});

test("a missing or null value is simply absent, not written as null", () => {
  const attrs = [attr({ slug: "title", type: "text" })];
  const out = valuesToFormula(attrs, { title: null });
  assert.equal("title" in out, false);
});

test("an archived attribute's value is never surfaced", () => {
  const attrs = [attr({ slug: "old_field", type: "text", archived_at: "2026-01-01T00:00:00Z" })];
  const out = valuesToFormula(attrs, { old_field: "still stored" });
  assert.equal("old_field" in out, false);
});

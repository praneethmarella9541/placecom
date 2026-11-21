import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeViewConfig } from "./view-config.ts";

test("empty settings are fine", () => {
  assert.deepEqual(sanitizeViewConfig(undefined), { ok: true, config: {} });
  assert.deepEqual(sanitizeViewConfig({}), { ok: true, config: {} });
});

test("keeps columns in order and drops repeats", () => {
  const r = sanitizeViewConfig({ columns: ["job_title", "company", "job_title"] });
  assert.deepEqual(r, { ok: true, config: { columns: ["job_title", "company"] } });
});

test("refuses bad column names and too many columns", () => {
  assert.equal(sanitizeViewConfig({ columns: ["Job Title"] }).ok, false);
  assert.equal(sanitizeViewConfig({ columns: ["a;drop"] }).ok, false);
  assert.equal(sanitizeViewConfig({ columns: Array.from({ length: 41 }, (_, i) => `c${i}`) }).ok, false);
  assert.equal(sanitizeViewConfig({ columns: "job_title" }).ok, false);
});

test("filters need a known condition and, for contains and is, a value", () => {
  const good = sanitizeViewConfig({ filters: [{ attribute: "job_title", op: "contains", value: " manager " }, { attribute: "company", op: "not_empty" }] });
  assert.deepEqual(good, {
    ok: true,
    config: { filters: [{ attribute: "job_title", op: "contains", value: "manager" }, { attribute: "company", op: "not_empty", value: undefined }] },
  });
  assert.equal(sanitizeViewConfig({ filters: [{ attribute: "x", op: "like", value: "a" }] }).ok, false);
  assert.equal(sanitizeViewConfig({ filters: [{ attribute: "x", op: "eq" }] }).ok, false);
  assert.equal(sanitizeViewConfig({ filters: [{ attribute: "x", op: "eq", value: "   " }] }).ok, false);
  assert.equal(sanitizeViewConfig({ filters: Array.from({ length: 11 }, () => ({ attribute: "x", op: "empty" })) }).ok, false);
});

test("is not, before and after need a value like the others", () => {
  assert.equal(sanitizeViewConfig({ filters: [{ attribute: "closes", op: "before", value: "2026-12-31" }] }).ok, true);
  assert.equal(sanitizeViewConfig({ filters: [{ attribute: "tag", op: "neq", value: "Hot" }] }).ok, true);
  assert.equal(sanitizeViewConfig({ filters: [{ attribute: "closes", op: "after" }] }).ok, false);
});

test("a filter's attribute can't smuggle query syntax", () => {
  assert.equal(sanitizeViewConfig({ filters: [{ attribute: "x,or(a.eq.1)", op: "empty" }] }).ok, false);
});

test("sort takes a core column or a field, and a direction", () => {
  assert.deepEqual(sanitizeViewConfig({ sort: "name", direction: "desc" }), { ok: true, config: { sort: "name", direction: "desc" } });
  assert.equal(sanitizeViewConfig({ sort: "values->>x" }).ok, false);
  assert.equal(sanitizeViewConfig({ direction: "up" }).ok, false);
});

test("column widths are kept, rounded and clamped", () => {
  assert.deepEqual(sanitizeViewConfig({ widths: { name: 300.4, job_title: 5, company: 5000 } }), { ok: true, config: { widths: { name: 300, job_title: 60, company: 800 } } });
  assert.equal(sanitizeViewConfig({ widths: { "Bad Slug": 100 } }).ok, false);
  assert.equal(sanitizeViewConfig({ widths: { name: "wide" } }).ok, false);
  assert.equal(sanitizeViewConfig({ widths: [100] }).ok, false);
});

test("settings that aren't an object are refused", () => {
  assert.equal(sanitizeViewConfig("columns").ok, false);
  assert.equal(sanitizeViewConfig([1]).ok, false);
});

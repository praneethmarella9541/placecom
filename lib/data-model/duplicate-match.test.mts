import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeForMatch } from "./duplicate-match.ts";

test("null, undefined and blank values mean nothing to match yet", () => {
  assert.equal(normalizeForMatch(null, "exact"), null);
  assert.equal(normalizeForMatch(undefined, "exact"), null);
  assert.equal(normalizeForMatch("", "exact"), null);
  assert.equal(normalizeForMatch("   ", "exact"), null);
  assert.equal(normalizeForMatch([], "exact"), null);
});

test("exact keeps case and only trims", () => {
  assert.equal(normalizeForMatch("  Ravi Kumar  ", "exact"), "Ravi Kumar");
  assert.equal(normalizeForMatch("Ravi", "exact"), "Ravi");
});

test("normalized lower-cases as well as trims", () => {
  assert.equal(normalizeForMatch("  Ravi Kumar  ", "normalized"), "ravi kumar");
  assert.equal(normalizeForMatch("RAVI", "normalized"), normalizeForMatch("ravi", "normalized"));
});

test("numbers and other scalars stringify", () => {
  assert.equal(normalizeForMatch(90000, "exact"), "90000");
  assert.equal(normalizeForMatch(true, "exact"), "true");
});

test("a multi-value field matches regardless of the stored order", () => {
  const a = normalizeForMatch(["Goa", "Manali"], "normalized");
  const b = normalizeForMatch(["manali", "goa"], "normalized");
  assert.equal(a, b);
});

test("a multi-value field with no real entries (blanks only) is nothing to match", () => {
  assert.equal(normalizeForMatch(["", "  "], "exact"), null);
});

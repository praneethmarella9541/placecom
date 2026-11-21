import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeValues } from "./merge-values.ts";
import type { AttributeDef } from "./types";

const attr = (slug: string, type: AttributeDef["type"], is_multi = false): AttributeDef => ({
  slug, name: slug, type, is_multi, config: {}, is_required: false, is_unique: false,
});
const attrs = [attr("email_addresses", "email", true), attr("job_title", "text"), attr("company", "record_ref"), attr("tags", "multi_select")];

test("the winner wins a clash; a value only the loser has is kept", () => {
  const merged = mergeValues(attrs, { job_title: "CEO" }, { job_title: "Intern", company: "c1" });
  assert.deepEqual(merged, { job_title: "CEO", company: "c1" });
});

test("multi-value fields are unioned, winner first, no repeats", () => {
  const merged = mergeValues(attrs, { email_addresses: ["a@x.com", "b@x.com"] }, { email_addresses: ["b@x.com", "c@x.com"], tags: ["x"] });
  assert.deepEqual(merged.email_addresses, ["a@x.com", "b@x.com", "c@x.com"]);
  assert.deepEqual(merged.tags, ["x"]);
});

test("an empty value on the winner falls back to the loser's", () => {
  assert.deepEqual(mergeValues(attrs, { job_title: "" }, { job_title: "Analyst" }), { job_title: "Analyst" });
});

test("merging with an empty record changes nothing", () => {
  assert.deepEqual(mergeValues(attrs, { job_title: "CEO" }, {}), { job_title: "CEO" });
  assert.deepEqual(mergeValues(attrs, {}, { job_title: "CEO" }), { job_title: "CEO" });
});

test("fields no attribute knows about are carried over, not dropped", () => {
  assert.deepEqual(mergeValues(attrs, { hidden: 1 }, { other: 2 }), { hidden: 1, other: 2 });
});

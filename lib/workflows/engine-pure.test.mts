import { test } from "node:test";
import assert from "node:assert/strict";
import { getPath, resolveValue, variablesIn } from "./template.ts";
import { conditionHolds, conditionsHold } from "./conditions.ts";
import { sanitizeTrigger, sanitizeTriggerDraft, triggerMatches } from "./triggers.ts";
import { nextFireAt, zonedTimeToUtc } from "./schedule.ts";

const data = { trigger: { record: { id: "r1", name: "Ana", values: { emails: ["a@x.com", "b@x.com"], score: 7, status: "Won" } } }, b2: { found: 0 } };

test("paths read nested values and arrays, and never the prototype", () => {
  assert.equal(getPath(data, "trigger.record.name"), "Ana");
  assert.equal(getPath(data, "trigger.record.values.emails.1"), "b@x.com");
  assert.equal(getPath(data, "trigger.nope.x"), undefined);
  assert.equal(getPath(data, "trigger.__proto__"), undefined);
  assert.equal(getPath({}, "constructor.name"), undefined);
});

test("a lone variable keeps its type; text with variables becomes a string; fallbacks fill empties", () => {
  assert.equal(resolveValue("{{trigger.record.values.score}}", data), 7);
  assert.deepEqual(resolveValue("{{trigger.record.values.emails}}", data), ["a@x.com", "b@x.com"]);
  assert.equal(resolveValue("Hi {{trigger.record.name}}, score {{trigger.record.values.score}}", data), "Hi Ana, score 7");
  assert.equal(resolveValue("{{trigger.record.values.missing}}", data, "n/a"), "n/a");
  assert.equal(resolveValue("Hi {{trigger.nope}}!", data, "there"), "Hi there!");
  assert.equal(resolveValue(5, data), 5);
  assert.deepEqual(variablesIn("a {{x.y}} b {{z}}"), ["x.y", "z"]);
});

test("conditions", () => {
  const c = (left: string, op: never, right?: string) => conditionHolds({ left, op, right }, data);
  assert.equal(c("{{trigger.record.values.status}}", "eq" as never, "won"), true);
  assert.equal(c("{{trigger.record.values.status}}", "neq" as never, "Lost"), true);
  assert.equal(c("{{trigger.record.values.emails}}", "contains" as never, "b@x"), true);
  assert.equal(c("{{trigger.record.values.score}}", "gt" as never, "5"), true);
  assert.equal(c("{{trigger.record.values.score}}", "lt" as never, "5"), false);
  assert.equal(c("{{trigger.record.values.missing}}", "empty" as never), true);
  assert.equal(c("{{b2.found}}", "not_empty" as never), true); // 0 is a value, not empty
  assert.equal(conditionsHold("any", [{ left: "x", op: "eq", right: "y" }, { left: "Ana", op: "eq", right: "ana" }], data), true);
  assert.equal(conditionsHold("all", [{ left: "x", op: "eq", right: "y" }, { left: "Ana", op: "eq", right: "ana" }], data), false);
  assert.equal(conditionsHold("all", [], data), true);
});

const ev = (over: Record<string, unknown>) => ({ type: "record.created", object_slug: "people", list_id: null, attribute_slug: null, old_value: null, new_value: null, payload: {}, ...over }) as never;

test("triggers match their own event only", () => {
  assert.equal(triggerMatches({ type: "record_created", config: { object: "people" } }, ev({})), true);
  assert.equal(triggerMatches({ type: "record_created", config: { object: "deals" } }, ev({})), false);
  assert.equal(triggerMatches({ type: "record_created", config: { object: "people" } }, ev({ type: "record.updated" })), false);
  assert.equal(triggerMatches({ type: "record_updated", config: { object: "people", attributes: ["job_title"] } }, ev({ type: "record.updated", payload: { changed: ["job_title"] } })), true);
  assert.equal(triggerMatches({ type: "record_updated", config: { object: "people", attributes: ["job_title"] } }, ev({ type: "record.updated", payload: { changed: ["company"] } })), false);
  assert.equal(triggerMatches({ type: "attribute_changed", config: { object: "deals", attribute: "status", to: "won" } }, ev({ type: "attribute.changed", object_slug: "deals", attribute_slug: "status", new_value: "Won" })), true);
  assert.equal(triggerMatches({ type: "attribute_changed", config: { object: "deals", attribute: "status", from: "Open" } }, ev({ type: "attribute.changed", object_slug: "deals", attribute_slug: "status", old_value: "New", new_value: "Won" })), false);
  assert.equal(triggerMatches({ type: "list_added", config: { list: "L1" } }, ev({ type: "list.added", list_id: "L1" })), true);
  assert.equal(triggerMatches({ type: "list_entry_updated", config: { list: "L1", attribute: "stage", to: "S2" } }, ev({ type: "list.entry_updated", list_id: "L1", attribute_slug: "stage", new_value: "S2" })), true);
  assert.equal(triggerMatches({ type: "schedule", config: {} }, ev({})), false);
});

test("sanitizeTrigger checks each trigger's settings", () => {
  assert.equal(sanitizeTrigger({ type: null }).ok, true);
  assert.equal(sanitizeTrigger({ type: "record_created", config: {} }).ok, false);
  assert.equal(sanitizeTrigger({ type: "record_created", config: { object: "people" } }).ok, true);
  assert.equal(sanitizeTrigger({ type: "list_added", config: { list: "nope" } }).ok, false);
  assert.equal(sanitizeTrigger({ type: "schedule", config: { every: "day", at: "9am" } }).ok, true); // bad time falls back to 09:00
  assert.equal(sanitizeTrigger({ type: "schedule", config: { every: "year" } }).ok, false);
  assert.equal(sanitizeTrigger({ type: "schedule", config: { every: "day", tz: "Mars/Base" } }).ok, false);
  assert.equal(sanitizeTrigger({ type: "launch_missiles" }).ok, false);
});

test("zoned times: 09:00 in Kolkata is 03:30 UTC; summer New York is UTC-4", () => {
  assert.equal(new Date(zonedTimeToUtc(2026, 12, 1, 9, 0, "Asia/Kolkata")).toISOString(), "2026-12-01T03:30:00.000Z");
  assert.equal(new Date(zonedTimeToUtc(2026, 7, 1, 9, 0, "America/New_York")).toISOString(), "2026-07-01T13:00:00.000Z");
  assert.equal(new Date(zonedTimeToUtc(2026, 1, 1, 9, 0, "America/New_York")).toISOString(), "2026-01-01T14:00:00.000Z");
});

test("next fire time", () => {
  assert.equal(nextFireAt({ every: "hour" }, new Date("2026-12-01T10:20:00Z")).toISOString(), "2026-12-01T11:00:00.000Z");
  // 09:00 IST = 03:30Z. After 04:00Z the same day, the next is tomorrow.
  assert.equal(nextFireAt({ every: "day", at: "09:00", tz: "Asia/Kolkata" }, new Date("2026-12-01T02:00:00Z")).toISOString(), "2026-12-01T03:30:00.000Z");
  assert.equal(nextFireAt({ every: "day", at: "09:00", tz: "Asia/Kolkata" }, new Date("2026-12-01T04:00:00Z")).toISOString(), "2026-12-02T03:30:00.000Z");
  // Weekly on Monday (1). 2026-12-01 is a Tuesday, so the next Monday is 2026-12-07.
  assert.equal(nextFireAt({ every: "week", at: "09:00", weekday: 1, tz: "Asia/Kolkata" }, new Date("2026-12-01T04:00:00Z")).toISOString(), "2026-12-07T03:30:00.000Z");
});

test("a draft may hold an unfinished trigger; a publish may not", () => {
  const half = { type: "attribute_changed", config: { object: "people" } }; // no field chosen yet
  assert.equal(sanitizeTrigger(half).ok, false);
  const d = sanitizeTriggerDraft(half);
  assert.equal(d.ok, true);
  if (d.ok) assert.deepEqual(d.trigger, { type: "attribute_changed", config: { object: "people" } });
  assert.equal(sanitizeTriggerDraft({ type: "attribute_changed", config: { object: "people", attribute: "name" } }).ok, true);
  // Still refuses an unknown trigger and keeps only plain values.
  assert.equal(sanitizeTriggerDraft({ type: "launch_missiles" }).ok, false);
  const messy = sanitizeTriggerDraft({ type: "record_updated", config: { object: "people", nested: { a: 1 }, "bad key!": "x", attributes: ["a", 5] } });
  assert.equal(messy.ok, true);
  if (messy.ok) assert.deepEqual(messy.trigger.config, { object: "people", attributes: ["a"] });
});

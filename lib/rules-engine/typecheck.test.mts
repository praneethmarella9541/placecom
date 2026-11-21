import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./parser.ts";
import { typeCheck } from "./typecheck.ts";
import { FormulaError } from "./types.ts";
import type { ObjectSchema } from "./types.ts";

const companySchema: ObjectSchema = {
  Name: { type: "text" },
  industry: { type: "text" },
};

const tripsSchema: ObjectSchema = {
  Name: { type: "text" },
  package_value: { type: "number" },
  start_date: { type: "date" },
  end_date: { type: "date" },
  travellers: { type: "number" },
  stage: { type: "text" },
  cancellation_reason: { type: "text" },
  destinations: { type: "list" },
  traveller: { type: "text", link: { Name: { type: "text" }, company: { type: "text", link: companySchema } } },
};

const ok = (src: string) => typeCheck(parse(src), tripsSchema);
const bad = (src: string) => assert.throws(() => typeCheck(parse(src), tripsSchema), FormulaError);

test("a known field resolves to its declared type", () => {
  assert.equal(ok("package_value"), "number");
  assert.equal(ok("Name"), "text");
});

test("an unknown field is a save-time error", () => {
  bad("not_a_field");
});

test("a multi-value field is type list", () => {
  assert.equal(ok("destinations"), "list");
});

test("cross-record field paths resolve through link schemas, up to the hop cap", () => {
  assert.equal(ok("traveller.company.industry"), "text");
  bad("traveller.company.industry.extra"); // 3 hops, over MAX_LINK_DEPTH of 2
});

test("hopping through a field that isn't a link is an error", () => {
  bad("stage.whatever");
});

test("$User and $Workspace context fields", () => {
  assert.equal(ok("$User.Email"), "text");
  assert.equal(ok("$Workspace.Name"), "text");
  bad("$User.NoSuchField");
  bad("$User"); // needs a sub-field
});

test("comparisons need matching families", () => {
  assert.equal(ok("package_value > 90000"), "boolean");
  assert.equal(ok("start_date <= end_date"), "boolean");
  bad('package_value > "90000"');
  bad("start_date > package_value");
});

test("= and != allow any two same-family types, including against null", () => {
  assert.equal(ok("stage = null"), "boolean");
  bad('package_value = "x"');
});

test("+ - * / need numbers; - also allows two dates (days between)", () => {
  assert.equal(ok("package_value * 2"), "number");
  assert.equal(ok("end_date - start_date"), "number");
  bad('package_value + "x"');
});

test("& needs text on both sides", () => {
  assert.equal(ok('"Value: " & TEXT(package_value)'), "text");
  bad("package_value & 1");
});

test("AND/OR need 2+ booleans, NOT needs exactly 1", () => {
  assert.equal(ok("AND(package_value > 0, travellers > 0)"), "boolean");
  bad("AND(package_value > 0)");
  bad("NOT(package_value)");
});

test("IF checks the condition and unifies the two branches' types", () => {
  assert.equal(ok("IF(package_value > 90000, 1, 0)"), "number");
  bad("IF(package_value, 1, 0)"); // condition must be boolean
});

test("CASE needs expr + pairs + default, and matching value types", () => {
  assert.equal(ok('CASE(stage, "Booked", 1, "Cancelled", 2, 0)'), "number");
  bad('CASE(stage, "Booked", 1)'); // odd total arg count: a value with no result and no default
  bad('CASE(stage, 5, 1, 0)'); // 5 doesn't match stage's text type
});

test("ISNEW takes no arguments; ISCHANGED/PRIORVALUE take one bare field of this record", () => {
  assert.equal(ok("ISNEW()"), "boolean");
  assert.equal(ok("ISCHANGED(stage)"), "boolean");
  assert.equal(ok("PRIORVALUE(stage)"), "text");
  bad("ISCHANGED(stage = 'Booked')"); // not a bare field
  bad("ISCHANGED(traveller.company.industry)"); // not THIS record's own field
});

test("a function call is checked for arity and argument types", () => {
  assert.equal(ok("LEN(stage)"), "number");
  bad("LEN(package_value)");
  bad("ROUND(package_value, 1, 1)");
  bad("NOSUCHFUNCTION(1)");
});

test("BETWEEN accepts numbers or dates, not a mix", () => {
  assert.equal(ok("BETWEEN(travellers, 1, 50)"), "boolean");
  assert.equal(ok("BETWEEN(start_date, DATE(2026,1,1), DATE(2026,12,31))"), "boolean");
  bad("BETWEEN(travellers, start_date, end_date)");
});

test("INCLUDES needs a list first and text second", () => {
  assert.equal(ok('INCLUDES(destinations, "Goa")'), "boolean");
  bad('INCLUDES(stage, "Goa")');
});

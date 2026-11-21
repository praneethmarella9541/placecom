import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./parser.ts";
import { FormulaError } from "./types.ts";
import type { Expr } from "./ast.ts";

test("literals", () => {
  assert.deepEqual((parse("42") as Expr & { kind: "literal" }).value, 42);
  assert.deepEqual((parse('"hi"') as Expr & { kind: "literal" }).value, "hi");
  assert.equal((parse("TRUE") as Expr & { kind: "literal" }).value, true);
  assert.equal((parse("false") as Expr & { kind: "literal" }).value, false);
  assert.equal((parse("null") as Expr & { kind: "literal" }).value, null);
});

test("a bare identifier is a field, a dotted one is a field path", () => {
  const f = parse("package_value") as Expr & { kind: "field" };
  assert.deepEqual(f.path, ["package_value"]);
  const g = parse("traveller.company.industry") as Expr & { kind: "field" };
  assert.deepEqual(g.path, ["traveller", "company", "industry"]);
});

test("a call collects its arguments", () => {
  const c = parse("ROUND(package_value, 2)") as Expr & { kind: "call" };
  assert.equal(c.name, "ROUND");
  assert.equal(c.args.length, 2);
  assert.deepEqual((c.args[1] as Expr & { kind: "literal" }).value, 2);
});

test("a function name is case-folded to upper, a field path is not", () => {
  const c = parse("round(Package_Value, 2)") as Expr & { kind: "call" };
  assert.equal(c.name, "ROUND");
  const arg0 = c.args[0] as Expr & { kind: "field" };
  assert.deepEqual(arg0.path, ["Package_Value"]);
});

test("arithmetic precedence: * before +, parens override", () => {
  const e = parse("1 + 2 * 3") as Expr & { kind: "binary" };
  assert.equal(e.op, "+");
  assert.equal((e.right as Expr & { kind: "binary" }).op, "*");
  const p = parse("(1 + 2) * 3") as Expr & { kind: "binary" };
  assert.equal(p.op, "*");
  assert.equal((p.left as Expr & { kind: "binary" }).op, "+");
});

test("comparisons sit below + and &, and don't chain", () => {
  const e = parse("1 + 2 > 2") as Expr & { kind: "binary" };
  assert.equal(e.op, ">");
  assert.equal((e.left as Expr & { kind: "binary" }).op, "+");
  assert.throws(() => parse("1 < 2 < 3"), FormulaError);
});

test("& binds tighter than comparison but looser than +", () => {
  const e = parse('"a" & 1 + 1 = "a2"') as Expr & { kind: "binary" };
  assert.equal(e.op, "=");
  assert.equal((e.left as Expr & { kind: "binary" }).op, "&");
});

test("unary minus, including stacked", () => {
  const e = parse("--5") as Expr & { kind: "unary" };
  assert.equal(e.op, "-");
  assert.equal((e.expr as Expr & { kind: "unary" }).op, "-");
});

test("<> parses the same as !=", () => {
  const a = parse("1 <> 2") as Expr & { kind: "binary" };
  assert.equal(a.op, "!=");
});

test("a dangling operator is a parse error with a position", () => {
  try {
    parse("1 +");
    assert.fail("expected a FormulaError");
  } catch (e) {
    assert.ok(e instanceof FormulaError);
    assert.ok(e.pos.start >= 0);
  }
});

test("a missing closing parenthesis is an error", () => {
  assert.throws(() => parse("(1 + 2"), FormulaError);
});

test("an unexpected trailing token is an error", () => {
  assert.throws(() => parse("1 2"), FormulaError);
});

test("an empty formula is an error", () => {
  assert.throws(() => parse(""), FormulaError);
});

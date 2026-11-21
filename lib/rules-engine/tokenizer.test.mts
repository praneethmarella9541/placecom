import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "./tokenizer.ts";
import { FormulaError } from "./types.ts";

const types = (src: string) => tokenize(src).map((t) => t.type);
const texts = (src: string) => tokenize(src).map((t) => t.text);

test("numbers, including decimals", () => {
  const toks = tokenize("12 3.5 0.25");
  assert.deepEqual(toks.slice(0, 3).map((t) => t.value), [12, 3.5, 0.25]);
});

test("strings with escapes, single and double quoted", () => {
  const toks = tokenize(`"a\\"b" 'c\\'d' "line\\nbreak"`);
  assert.deepEqual(toks.slice(0, 3).map((t) => t.value), [`a"b`, `c'd`, "line\nbreak"]);
});

test("an unterminated string is an error with a position", () => {
  assert.throws(() => tokenize('"never closes'), FormulaError);
});

test("identifiers, including $-prefixed context names and dotted paths", () => {
  assert.deepEqual(types("package_value"), ["ident", "eof"]);
  assert.deepEqual(types("$User.Id"), ["ident", ".", "ident", "eof"]);
  assert.deepEqual(texts("traveller.company.industry"), ["traveller", ".", "company", ".", "industry", ""]);
});

test("operators, including the two-character ones and <> as != ", () => {
  assert.deepEqual(types("= != < <= > >= <>"), ["=", "!=", "<", "<=", ">", ">=", "!=", "eof"]);
  assert.deepEqual(types("+ - * / &"), ["+", "-", "*", "/", "&", "eof"]);
});

test("whitespace of every kind is skipped", () => {
  assert.deepEqual(types("1\t+\n2\r\n"), ["number", "+", "number", "eof"]);
});

test("an unknown character is an error", () => {
  assert.throws(() => tokenize("a # b"), FormulaError);
});

test("a formula that is too long is rejected before tokenizing it", () => {
  assert.throws(() => tokenize("1".repeat(10_001)), FormulaError);
});

test("positions point at the right span", () => {
  const toks = tokenize("12 ab");
  assert.deepEqual(toks[0].pos, { start: 0, end: 2 });
  assert.deepEqual(toks[1].pos, { start: 3, end: 5 });
});

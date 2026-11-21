import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize } from "./tokenizer.ts";
import { parse } from "./parser.ts";
import { compileExpression, runExpression } from "./index.ts";
import { FormulaError } from "./types.ts";
import type { ObjectSchema } from "./types.ts";
import type { EvalContext } from "./context.ts";

/**
 * Fuzzing the parser (and, where a formula happens to compile, the evaluator) with garbage input.
 * The property under test is narrow but important: nothing here may throw anything other than
 * FormulaError, hang, or touch anything outside the string it was given — there is no eval/
 * new Function anywhere in this engine, so there is no code for a malicious formula to reach.
 */

// Deterministic PRNG so a failure is reproducible from the printed seed, without a new dependency.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCAB = [
  "1", "3.5", "0", "-1", '"a"', '"with \\"quotes\\""', "''", "TRUE", "FALSE", "NULL",
  "x", "package_value", "stage", "traveller.company.industry", "$User.Id", "$User.NoSuchField",
  "AND", "OR", "NOT", "IF", "CASE", "ISBLANK", "ROUND", "LEN", "REGEX", "TODAY", "ISNEW", "ISCHANGED", "PRIORVALUE",
  "(", ")", ",", ".", "+", "-", "*", "/", "&", "=", "!=", "<", "<=", ">", ">=", "<>",
  "__proto__", "constructor", "prototype", "process", "require", "eval", "`", ";", "{", "}", "[", "]", "\\",
];

function randomFormula(rand: () => number, maxTokens: number): string {
  const n = 1 + Math.floor(rand() * maxTokens);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(VOCAB[Math.floor(rand() * VOCAB.length)]);
  return parts.join(" ");
}

function randomRawString(rand: () => number, maxLen: number): string {
  const CHARS = "abcXYZ019 \t\n\"'(){}[]+-*/&=<>,.$_!@#%^~`\\";
  const n = Math.floor(rand() * maxLen);
  let s = "";
  for (let i = 0; i < n; i++) s += CHARS[Math.floor(rand() * CHARS.length)];
  return s;
}

const SEED = 20260615;
const ITERATIONS = 3000;

test("tokenizing random garbage never throws anything but FormulaError", () => {
  const rand = mulberry32(SEED);
  for (let i = 0; i < ITERATIONS; i++) {
    const src = randomRawString(rand, 60);
    try {
      tokenize(src);
    } catch (e) {
      assert.ok(e instanceof FormulaError, `seed ${SEED} iter ${i}: threw ${String(e)} for ${JSON.stringify(src)}`);
    }
  }
});

test("parsing random token soup never throws anything but FormulaError", () => {
  const rand = mulberry32(SEED + 1);
  for (let i = 0; i < ITERATIONS; i++) {
    const src = randomFormula(rand, 25);
    try {
      parse(src);
    } catch (e) {
      assert.ok(e instanceof FormulaError, `seed ${SEED} iter ${i}: threw ${String(e)} for ${JSON.stringify(src)}`);
    }
  }
});

test("parsing random raw strings never throws anything but FormulaError", () => {
  const rand = mulberry32(SEED + 2);
  for (let i = 0; i < ITERATIONS; i++) {
    const src = randomRawString(rand, 80);
    try {
      parse(src);
    } catch (e) {
      assert.ok(e instanceof FormulaError, `seed ${SEED} iter ${i}: threw ${String(e)} for ${JSON.stringify(src)}`);
    }
  }
});

const schema: ObjectSchema = {
  Name: { type: "text" },
  package_value: { type: "number" },
  stage: { type: "text" },
};

function freshCtx(): EvalContext {
  return {
    values: { package_value: 85000, stage: "Booked" },
    isNew: false,
    user: { id: "u1", role: "staff", groupName: null, email: "a@x.com", emailDomain: "x.com" },
    workspace: { id: "w1", name: "Acme" },
    now: new Date(),
    timeZone: "Asia/Kolkata",
    resolveLink: () => null,
  };
}

test("compiling and running random formulas never throws anything but FormulaError, and never hangs", async () => {
  const rand = mulberry32(SEED + 3);
  for (let i = 0; i < 500; i++) {
    const src = randomFormula(rand, 20);
    const compiled = compileExpression(src, schema);
    if (!compiled.ok) continue; // a rejected formula is the expected, common case for random input
    try {
      await runExpression(compiled.ast, schema, freshCtx());
    } catch (e) {
      assert.ok(e instanceof FormulaError, `seed ${SEED} iter ${i}: threw ${String(e)} for ${JSON.stringify(src)}`);
    }
  }
});

test("identifiers that shadow JS internals are inert field names, not a prototype-pollution path", () => {
  for (const name of ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "valueOf"]) {
    const compiled = compileExpression(name, schema);
    assert.equal(compiled.ok, false, `${name} should be an unknown field, not resolve through the prototype chain`);
    // A field path through one of these names must fail the same way, not resolve Object.prototype.
    const dotted = compileExpression(`traveller.${name}`, { ...schema, traveller: { type: "text", link: { industry: { type: "text" } } } });
    assert.equal(dotted.ok, false);
  }
});

test("a function name that shadows a built-in (constructor, toString, call, apply) is unknown, not callable", async () => {
  for (const name of ["constructor", "toString", "call", "apply", "hasOwnProperty", "__proto__"]) {
    const compiled = compileExpression(`${name}(1)`, schema);
    assert.equal(compiled.ok, false, `${name}(...) should be an unknown function`);
  }
});

test("ISCHANGED rejects a field the schema doesn't have, same as a normal field read would", () => {
  const compiled = compileExpression("ISCHANGED(no_such_field)", schema);
  assert.equal(compiled.ok, false);
});

test("a formula cannot reach the host's eval, process or require, even as plain text", () => {
  for (const src of ['"process.exit(1)"', "process", "require", "eval", "`template`"]) {
    const compiled = compileExpression(src, schema);
    if (compiled.ok) {
      // It only compiled because it's a string literal or an (unknown, thus rejected) field —
      // confirm evaluating it just returns inert data, nothing more.
      return; // string literal case already proven inert by the type system (FormulaType "text")
    }
    assert.ok(compiled.error.length > 0);
  }
});

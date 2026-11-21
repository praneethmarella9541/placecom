import type { Expr } from "./ast";
import type { EvalContext } from "./context";
import { evaluate } from "./evaluate";
import { parse } from "./parser";
import { typeCheck } from "./typecheck";
import { FormulaError, type FormulaType, type FormulaValue, type ObjectSchema } from "./types";

export type { Expr } from "./ast";
export type { EvalContext } from "./context";
export type { FieldSchema, FormulaType, FormulaValue, ObjectSchema, Position, Typed } from "./types";
export { FormulaError } from "./types";
export { FUNCTIONS } from "./functions";

export type CompileResult =
  | { ok: true; ast: Expr; returnType: FormulaType; source: string }
  | { ok: false; error: string; pos: { start: number; end: number } };

/**
 * Parses and type-checks a formula against an object's field schema. Call this when a rule is
 * SAVED — never execution, so a bad formula is caught then, with a message and the exact span to
 * underline, rather than the first time a record happens to exercise it.
 */
export function compileExpression(source: string, schema: ObjectSchema): CompileResult {
  try {
    const ast = parse(source);
    const returnType = typeCheck(ast, schema);
    return { ok: true, ast, returnType, source };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message, pos: e.pos };
    throw e;
  }
}

/**
 * Runs an already-compiled AST against one record. Returns the result or `{ ok: false }` with a
 * message if evaluation itself failed (VALUE() on non-numeric text, divide by zero, a field the
 * schema no longer has) — the caller decides what that means for the save (lib/data-model, phase 2).
 */
export async function runExpression(ast: Expr, schema: ObjectSchema, ctx: EvalContext): Promise<{ ok: true; value: FormulaValue; type: FormulaType } | { ok: false; error: string }> {
  try {
    const result = await evaluate(ast, ctx, schema);
    return { ok: true, value: result.value, type: result.type };
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message };
    throw e;
  }
}

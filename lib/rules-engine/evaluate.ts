import type { BinaryOp, Expr } from "./ast";
import type { EvalContext } from "./context";
import { asBoolean, callFunction, num, text } from "./functions";
import { fieldType } from "./typecheck";
import { FormulaError, MAX_LINK_DEPTH, type FormulaValue, type ObjectSchema, type Position, type Typed } from "./types";

/**
 * Walks a type-checked AST against one record and produces a value. Async throughout, because a
 * cross-record field (`traveller.company.industry`) needs `ctx.resolveLink` — a database read the
 * caller supplies — but every other node resolves instantly; nothing here waits on anything of its
 * own. Field references are re-typed against `schema` here (not trusted from type-check time) in
 * case the rule is older than the field it reads; a field schema change between save and evaluation
 * throws a FormulaError, which the caller treats as "this rule needs re-checking," not a crash.
 */

const CONTEXT: Record<string, Record<string, (ctx: EvalContext) => string>> = {
  $User: {
    Id: (c) => c.user.id,
    Role: (c) => c.user.role,
    Group: (c) => c.user.groupName ?? "",
    Email: (c) => c.user.email,
    EmailDomain: (c) => c.user.emailDomain,
  },
  $Workspace: { Id: (c) => c.workspace.id, Name: (c) => c.workspace.name },
};

/** `Object.hasOwn`, not a bare index: `ctx.values["__proto__"]` on a plain object resolves to
 *  `Object.prototype` instead of `undefined` — the one non-"any identifier matches /^[a-z]/" slug
 *  shape the platform's own attribute-slug validation (lib/data-model/values.ts) can't rule out,
 *  since this engine has no such guarantee about what a future caller passes as `values`. */
function safeGet(obj: Record<string, FormulaValue> | undefined, key: string): FormulaValue {
  return obj && Object.hasOwn(obj, key) ? obj[key] : null;
}

function valuesEqual(a: FormulaValue, b: FormulaValue): boolean {
  if (a === null || b === null) return a === b;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) {
    const norm = (xs: string[]) => xs.map((x) => x.trim().toLowerCase()).sort();
    const na = norm(a);
    const nb = norm(b);
    return na.length === nb.length && na.every((v, i) => v === nb[i]);
  }
  return a === b;
}

async function readField(path: string[], ctx: EvalContext, schema: ObjectSchema, pos: Position): Promise<Typed> {
  // Object.hasOwn, not `in` or a truthiness check: a plain object indexed by a path segment that
  // happens to be "constructor" or "toString" would otherwise resolve through the prototype chain.
  if (Object.hasOwn(CONTEXT, path[0])) {
    const fields = CONTEXT[path[0]];
    const getter = Object.hasOwn(fields, path[1] ?? "") ? fields[path[1]] : undefined;
    if (!getter) throw new FormulaError(`${path.join(".")} isn't a recognised ${path[0]} field.`, pos);
    return { value: getter(ctx), type: "text" };
  }

  if (path.length - 1 > MAX_LINK_DEPTH) throw new FormulaError(`${path.join(".")} crosses too many linked records (max ${MAX_LINK_DEPTH}).`, pos);
  const type = fieldType(path, schema, pos);

  if (path.length === 1) {
    const v = safeGet(ctx.values, path[0]);
    return { value: v, type: v === null ? "null" : type };
  }

  const localId = safeGet(ctx.values, path[0]);
  if (typeof localId !== "string" || !localId) return { value: null, type: "null" }; // an empty link reads as blank, not an error
  const v = await ctx.resolveLink(path.slice(1), localId);
  return { value: v ?? null, type: v === null || v === undefined ? "null" : type };
}

export async function evaluate(expr: Expr, ctx: EvalContext, schema: ObjectSchema): Promise<Typed> {
  switch (expr.kind) {
    case "literal":
      return { value: expr.value, type: expr.type };

    case "field":
      return readField(expr.path, ctx, schema, expr.pos);

    case "unary": {
      const v = await evaluate(expr.expr, ctx, schema);
      return { value: -num(v, expr.pos), type: "number" };
    }

    case "binary":
      return evaluateBinary(expr.op, await evaluate(expr.left, ctx, schema), await evaluate(expr.right, ctx, schema), expr.pos);

    case "call":
      return evaluateCall(expr, ctx, schema);
  }
}

function evaluateBinary(op: BinaryOp, l: Typed, r: Typed, pos: Position): Typed {
  if (op === "&") return { value: text(l, pos) + text(r, pos), type: "text" };
  if (op === "=") return { value: valuesEqual(l.value, r.value), type: "boolean" };
  if (op === "!=") return { value: !valuesEqual(l.value, r.value), type: "boolean" };

  if (l.value instanceof Date && r.value instanceof Date) {
    const a = l.value.getTime();
    const b = r.value.getTime();
    if (op === "-") return { value: (a - b) / 86_400_000, type: "number" };
    if (op === "<") return { value: a < b, type: "boolean" };
    if (op === "<=") return { value: a <= b, type: "boolean" };
    if (op === ">") return { value: a > b, type: "boolean" };
    if (op === ">=") return { value: a >= b, type: "boolean" };
  }

  const a = num(l, pos);
  const b = num(r, pos);
  switch (op) {
    case "+": return { value: a + b, type: "number" };
    case "-": return { value: a - b, type: "number" };
    case "*": return { value: a * b, type: "number" };
    case "/":
      if (b === 0) throw new FormulaError("Can't divide by zero.", pos);
      return { value: a / b, type: "number" };
    case "<": return { value: a < b, type: "boolean" };
    case "<=": return { value: a <= b, type: "boolean" };
    case ">": return { value: a > b, type: "boolean" };
    case ">=": return { value: a >= b, type: "boolean" };
    default:
      throw new FormulaError(`Unsupported operator ${op}.`, pos);
  }
}

async function evaluateCall(expr: Expr & { kind: "call" }, ctx: EvalContext, schema: ObjectSchema): Promise<Typed> {
  const { name, args, pos } = expr;

  switch (name) {
    case "AND": {
      for (const a of args) if (!asBoolean(await evaluate(a, ctx, schema))) return { value: false, type: "boolean" };
      return { value: true, type: "boolean" };
    }
    case "OR": {
      for (const a of args) if (asBoolean(await evaluate(a, ctx, schema))) return { value: true, type: "boolean" };
      return { value: false, type: "boolean" };
    }
    case "NOT":
      return { value: !asBoolean(await evaluate(args[0], ctx, schema)), type: "boolean" };

    case "IF": {
      const cond = asBoolean(await evaluate(args[0], ctx, schema));
      return evaluate(cond ? args[1] : args[2], ctx, schema);
    }

    case "CASE": {
      const switchVal = (await evaluate(args[0], ctx, schema)).value;
      for (let i = 1; i + 1 < args.length; i += 2) {
        const candidate = await evaluate(args[i], ctx, schema);
        if (valuesEqual(switchVal, candidate.value)) return evaluate(args[i + 1], ctx, schema);
      }
      return evaluate(args[args.length - 1], ctx, schema);
    }

    case "ISNEW":
      return { value: ctx.isNew, type: "boolean" };

    case "ISCHANGED": {
      const slug = (args[0] as Expr & { kind: "field" }).path[0];
      const prior = safeGet(ctx.priorValues, slug);
      const current = safeGet(ctx.values, slug);
      return { value: !valuesEqual(current, prior), type: "boolean" };
    }

    case "PRIORVALUE": {
      const slug = (args[0] as Expr & { kind: "field" }).path[0];
      const v = safeGet(ctx.priorValues, slug);
      return { value: v, type: v === null ? "null" : fieldType([slug], schema, pos) };
    }

    default: {
      const values: Typed[] = [];
      for (const a of args) values.push(await evaluate(a, ctx, schema)); // sequential: bounds concurrent cross-record reads
      return callFunction(name, values, ctx, pos);
    }
  }
}


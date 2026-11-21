import type { BinaryOp, Expr } from "./ast";
import { checkFunction } from "./functions";
import { FormulaError, MAX_LINK_DEPTH, type FormulaType, type ObjectSchema, type Position } from "./types";

/**
 * Static type check: walks the AST once against the object's field schema, with no record data at
 * all, so a formula with an unknown field, a too-deep cross-record hop, or a type mismatch (`"x" >
 * 5`) is rejected when the rule is SAVED — never discovered the first time a record happens to
 * exercise that branch.
 */

const CONTEXT_FIELDS: Record<string, Record<string, FormulaType>> = {
  $User: { Id: "text", Role: "text", Group: "text", Email: "text", EmailDomain: "text" },
  $Workspace: { Id: "text", Name: "text" },
};

function compatible(a: FormulaType, b: FormulaType): boolean {
  return a === "null" || a === "any" || b === "null" || b === "any" || a === b;
}

function sameOrNullType(a: FormulaType, b: FormulaType): FormulaType {
  if (a === "null" || a === "any") return b;
  if (b === "null" || b === "any") return a;
  if (a === b) return a;
  return "any";
}

/** The type a field path resolves to: "Name" and the object's own fields at depth 0, one or two
 *  hops across record_ref/member fields after that, or a `$User`/`$Workspace` context field.
 *  Exported so evaluate.ts can tag a runtime value with the same type the parser already checked.
 *
 *  Every lookup below uses `Object.hasOwn`, never `in` or a bare `obj[key]` truthiness check: a
 *  plain object indexed by tenant-chosen text (a field name here) resolves "constructor",
 *  "toString", "__proto__" and friends through the prototype chain instead of failing, which is
 *  exactly the kind of foothold this engine exists to not have. */
export function fieldType(path: string[], schema: ObjectSchema, pos: Position): FormulaType {
  if (Object.hasOwn(CONTEXT_FIELDS, path[0])) {
    const ctxFields = CONTEXT_FIELDS[path[0]];
    if (path.length !== 2 || !Object.hasOwn(ctxFields, path[1])) {
      throw new FormulaError(`${path.join(".")} isn't a recognised ${path[0]} field.`, pos);
    }
    return ctxFields[path[1]];
  }
  if (path.length - 1 > MAX_LINK_DEPTH) {
    throw new FormulaError(`${path.join(".")} crosses too many linked records (max ${MAX_LINK_DEPTH}).`, pos);
  }
  let scope = schema;
  let type: FormulaType = "any";
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (!Object.hasOwn(scope, seg)) throw new FormulaError(`Unknown field "${seg}".`, pos);
    const field = scope[seg];
    type = field.isMulti ? "list" : field.type;
    if (i < path.length - 1) {
      if (!field.link) throw new FormulaError(`"${seg}" doesn't link to another record.`, pos);
      scope = field.link;
    }
  }
  return type;
}

/** ISCHANGED/PRIORVALUE take a bare field of THIS record, not a general expression. */
function requireOwnField(arg: Expr, fnName: string): string {
  if (arg.kind !== "field" || arg.path.length !== 1 || Object.hasOwn(CONTEXT_FIELDS, arg.path[0])) {
    throw new FormulaError(`${fnName} takes a single field of this record, not an expression.`, arg.pos);
  }
  return arg.path[0];
}

export function typeCheck(expr: Expr, schema: ObjectSchema): FormulaType {
  switch (expr.kind) {
    case "literal":
      return expr.type;

    case "field":
      return fieldType(expr.path, schema, expr.pos);

    case "unary": {
      const t = typeCheck(expr.expr, schema);
      if (t !== "number" && t !== "null" && t !== "any") throw new FormulaError("Unary - needs a number.", expr.pos);
      return "number";
    }

    case "binary": {
      const l = typeCheck(expr.left, schema);
      const r = typeCheck(expr.right, schema);
      return checkBinary(expr.op, l, r, expr.pos);
    }

    case "call":
      return typeCheckCall(expr, schema);
  }
}

function checkBinary(op: BinaryOp, l: FormulaType, r: FormulaType, pos: Position): FormulaType {
  const DATE_LIKE: FormulaType[] = ["date", "datetime"];
  const isNumOrFree = (t: FormulaType) => t === "number" || t === "null" || t === "any";
  const isDateOrFree = (t: FormulaType) => DATE_LIKE.includes(t) || t === "null" || t === "any";

  if (op === "&") {
    if (!(l === "text" || l === "null" || l === "any") || !(r === "text" || r === "null" || r === "any")) {
      throw new FormulaError("& joins text — wrap a number or date in TEXT() first.", pos);
    }
    return "text";
  }
  if (op === "+" || op === "*" || op === "/") {
    if (!isNumOrFree(l) || !isNumOrFree(r)) throw new FormulaError(`${op} needs numbers on both sides.`, pos);
    return "number";
  }
  if (op === "-") {
    if (DATE_LIKE.includes(l) && DATE_LIKE.includes(r)) return "number"; // date - date = days between
    if (!isNumOrFree(l) || !isNumOrFree(r)) throw new FormulaError("- needs two numbers, or two dates.", pos);
    return "number";
  }
  if (op === "=" || op === "!=") {
    if (!compatible(l, r)) throw new FormulaError(`Can't compare ${l} with ${r}.`, pos);
    return "boolean";
  }
  // < <= > >=
  if (isNumOrFree(l) && isNumOrFree(r)) return "boolean";
  if (isDateOrFree(l) && isDateOrFree(r)) return "boolean";
  throw new FormulaError(`${op} needs two numbers, or two dates.`, pos);
}

function typeCheckCall(expr: Expr & { kind: "call" }, schema: ObjectSchema): FormulaType {
  const { name, args, pos } = expr;

  switch (name) {
    case "AND":
    case "OR": {
      if (args.length < 2) throw new FormulaError(`${name} takes at least 2 arguments.`, pos);
      for (const a of args) {
        const t = typeCheck(a, schema);
        if (t !== "boolean" && t !== "null" && t !== "any") throw new FormulaError(`${name}'s arguments must be TRUE or FALSE.`, a.pos);
      }
      return "boolean";
    }
    case "NOT": {
      if (args.length !== 1) throw new FormulaError("NOT takes exactly 1 argument.", pos);
      const t = typeCheck(args[0], schema);
      if (t !== "boolean" && t !== "null" && t !== "any") throw new FormulaError("NOT's argument must be TRUE or FALSE.", args[0].pos);
      return "boolean";
    }
    case "IF": {
      if (args.length !== 3) throw new FormulaError("IF takes exactly 3 arguments: condition, then, else.", pos);
      const cond = typeCheck(args[0], schema);
      if (cond !== "boolean" && cond !== "null" && cond !== "any") throw new FormulaError("IF's condition must be TRUE or FALSE.", args[0].pos);
      return sameOrNullType(typeCheck(args[1], schema), typeCheck(args[2], schema));
    }
    case "CASE": {
      if (args.length < 4 || args.length % 2 !== 0) {
        throw new FormulaError("CASE needs an expression, one or more value/result pairs, and a default result.", pos);
      }
      const exprType = typeCheck(args[0], schema);
      let resultType: FormulaType = "null";
      for (let i = 1; i + 1 < args.length; i += 2) {
        const valueType = typeCheck(args[i], schema);
        if (!compatible(exprType, valueType)) throw new FormulaError(`This value doesn't match CASE's first argument's type.`, args[i].pos);
        resultType = sameOrNullType(resultType, typeCheck(args[i + 1], schema));
      }
      resultType = sameOrNullType(resultType, typeCheck(args[args.length - 1], schema));
      return resultType;
    }
    case "ISNEW": {
      if (args.length !== 0) throw new FormulaError("ISNEW takes no arguments.", pos);
      return "boolean";
    }
    case "ISCHANGED": {
      if (args.length !== 1) throw new FormulaError("ISCHANGED takes exactly 1 field.", pos);
      const slug = requireOwnField(args[0], "ISCHANGED");
      fieldType([slug], schema, pos); // throws on an unknown field; the type itself isn't needed
      return "boolean";
    }
    case "PRIORVALUE": {
      if (args.length !== 1) throw new FormulaError("PRIORVALUE takes exactly 1 field.", pos);
      const slug = requireOwnField(args[0], "PRIORVALUE");
      return fieldType([slug], schema, pos);
    }
    default: {
      const argTypes = args.map((a) => typeCheck(a, schema));
      return checkFunction(name, argTypes, pos);
    }
  }
}

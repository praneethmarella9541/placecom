import { compileExpression, type CompileResult, type FormulaValue, type ObjectSchema } from "../rules-engine/index";
import { variablePathToSlug } from "./variable-slug";
import type { VariableOption } from "./describe";

export { variablePathToSlug } from "./variable-slug";

/**
 * An optional formula mode for the Filter and If-else blocks, sharing lib/rules-engine — the same
 * engine validation rules use — instead of a second condition language.
 *
 * Server-only in practice, even though nothing here touches a database: lib/rules-engine pulls in
 * node:vm (REGEX()'s sandboxed timeout), which webpack can't put in a browser bundle. blocks.ts
 * (server-only) is the one real caller; the builder UI imports variablePathToSlug directly from
 * ./variable-slug instead of from here, so its reference list doesn't drag the engine into the
 * client bundle too.
 */

export function buildStaticFormulaSchema(variables: VariableOption[]): ObjectSchema {
  const schema: ObjectSchema = {};
  for (const v of variables) schema[variablePathToSlug(v.path)] = { type: "any" };
  return schema;
}

/** Checks the formula compiles and works out to TRUE/FALSE — the only thing a condition can mean. */
export function compileConditionFormula(source: string, schema: ObjectSchema): CompileResult {
  const compiled = compileExpression(source, schema);
  if (!compiled.ok) return compiled;
  if (compiled.returnType !== "boolean" && compiled.returnType !== "any" && compiled.returnType !== "null") {
    return { ok: false, error: `This formula works out to a ${compiled.returnType}, not TRUE or FALSE.`, pos: { start: 0, end: source.length } };
  }
  return compiled;
}

const MAX_FLATTEN_DEPTH = 6;
const MAX_FLATTEN_KEYS = 300;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function toFormulaValue(raw: unknown): FormulaValue {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return raw;
  if (raw instanceof Date) return raw;
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  return null; // an object or anything else isn't representable — reads as blank, not an error
}

/**
 * Walks a run's whole data bag (trigger.record, trigger.event, every earlier block's output) into
 * flat slug -> value pairs, so the formula's schema always matches exactly what this run actually
 * has — nothing is ever "unknown field" because it happened to be optional and absent this time.
 * Depth- and key-capped against a pathologically deep or wide data shape (never expected in
 * practice: run data is built entirely by this engine, not from open-ended tenant input).
 */
export function flattenRuntimeData(data: unknown): { schema: ObjectSchema; values: Record<string, FormulaValue> } {
  const schema: ObjectSchema = {};
  const values: Record<string, FormulaValue> = {};
  const seen = new Set<string>();

  function walk(node: unknown, prefix: string, depth: number): void {
    if (seen.size >= MAX_FLATTEN_KEYS) return;
    if (isPlainObject(node) && depth < MAX_FLATTEN_DEPTH) {
      for (const [key, v] of Object.entries(node)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        walk(v, prefix ? `${prefix}.${key}` : key, depth + 1);
        if (seen.size >= MAX_FLATTEN_KEYS) return;
      }
      return;
    }
    if (!prefix || seen.has(prefix)) return;
    seen.add(prefix);
    const slug = variablePathToSlug(prefix);
    schema[slug] = { type: "any" };
    values[slug] = toFormulaValue(node);
  }

  walk(data, "", 0);
  return { schema, values };
}

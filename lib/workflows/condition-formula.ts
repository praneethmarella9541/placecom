import { compileExpression, type CompileResult, type FormulaValue, type ObjectSchema } from "../rules-engine/index";
import type { VariableOption } from "./describe";

/**
 * An optional formula mode for the Filter and If-else blocks, sharing lib/rules-engine — the same
 * engine validation rules use — instead of a second condition language. Pure and client-safe (no
 * database), same as the rest of this file's siblings in lib/workflows.
 *
 * A workflow variable path like "trigger.record.values.score" isn't a valid formula identifier (the
 * engine reads a dot as a cross-record hop, which this isn't), so it's offered to the formula as a
 * flat slug instead: TRIGGER_RECORD_VALUES_SCORE. variablePathToSlug is the one place that mapping is
 * made, used both by the builder's live hint (buildStaticFormulaSchema, from the same variable list
 * variablesFor() already offers the simple condition editor) and by the engine's real evaluation at
 * run time (blocks.ts's flattenRuntimeData, built from that run's actual data rather than a
 * pre-known list, so an optional path that happens to be absent this run reads as blank instead of
 * failing to compile at all).
 */

export function variablePathToSlug(path: string): string {
  return path.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=[0-9])/, "_");
}

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

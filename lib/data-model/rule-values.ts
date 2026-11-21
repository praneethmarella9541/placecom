import type { FormulaValue } from "../rules-engine/index";
import type { AttributeDef } from "./types";

/**
 * Converts a record's stored values (the plain JSON lib/data-model/values.ts normalizes into
 * `data_records.values`) into the shape lib/rules-engine expects: a date/timestamp string becomes a
 * `Date`, a multi-value field's array is kept as `string[]`, everything else passes through as-is.
 * Pure — no database, so the migration-equivalence tests can call it directly.
 */
export function valuesToFormula(attrs: AttributeDef[], values: Record<string, unknown>, name?: string): Record<string, FormulaValue> {
  const out: Record<string, FormulaValue> = { Name: name ?? "" };
  for (const attr of attrs) {
    if (attr.archived_at) continue;
    const raw = values[attr.slug];
    if (raw === undefined || raw === null) continue;

    const isMulti = attr.is_multi || attr.type === "multi_select";
    if (isMulti) {
      out[attr.slug] = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
      continue;
    }
    if (attr.type === "date" && typeof raw === "string") {
      const d = new Date(`${raw}T00:00:00Z`);
      out[attr.slug] = Number.isNaN(d.getTime()) ? null : d;
    } else if (attr.type === "timestamp" && typeof raw === "string") {
      const d = new Date(raw);
      out[attr.slug] = Number.isNaN(d.getTime()) ? null : d;
    } else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      out[attr.slug] = raw;
    }
  }
  return out;
}

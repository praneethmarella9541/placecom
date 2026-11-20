import type { FilterOp, RecordFilter } from "./types";

/**
 * What a saved view stores, and the check applied before it is saved. Pure: used by the API and by
 * values.test.mts. Slugs are only checked for shape here; a slug that no longer exists (a hidden
 * field) is skipped when the view loads, so a view never breaks because a field was archived.
 */

export type ViewConfig = {
  columns?: string[];
  filters?: RecordFilter[];
  sort?: string;
  direction?: "asc" | "desc";
  /** Column widths in pixels by field slug ("name" for the name column). */
  widths?: Record<string, number>;
};

const SLUG = /^[a-z][a-z0-9_]{0,39}$/;
const OPS = new Set<FilterOp>(["eq", "neq", "contains", "before", "after", "empty", "not_empty"]);
const SORT_CORE = new Set(["name", "created_at", "updated_at"]);
export const MAX_VIEW_COLUMNS = 40;
export const MAX_VIEW_FILTERS = 10;
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 800;

export function sanitizeViewConfig(raw: unknown): { ok: true; config: ViewConfig } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, config: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "A view's settings must be an object." };
  const input = raw as Record<string, unknown>;
  const config: ViewConfig = {};

  if (input.columns !== undefined) {
    if (!Array.isArray(input.columns) || input.columns.length > MAX_VIEW_COLUMNS) return { ok: false, error: "Too many columns." };
    const seen = new Set<string>();
    for (const c of input.columns) {
      if (typeof c !== "string" || !SLUG.test(c)) return { ok: false, error: "A column name isn't valid." };
      seen.add(c);
    }
    config.columns = [...seen];
  }

  if (input.filters !== undefined) {
    if (!Array.isArray(input.filters) || input.filters.length > MAX_VIEW_FILTERS) return { ok: false, error: `Use at most ${MAX_VIEW_FILTERS} filters.` };
    config.filters = [];
    for (const f of input.filters) {
      const item = f as { attribute?: unknown; op?: unknown; value?: unknown } | null;
      if (!item || typeof item.attribute !== "string" || !SLUG.test(item.attribute) || !OPS.has(item.op as FilterOp)) {
        return { ok: false, error: "A filter isn't valid." };
      }
      const needsValue = item.op !== "empty" && item.op !== "not_empty";
      if (needsValue && (typeof item.value !== "string" || !item.value.trim() || item.value.length > 200)) {
        return { ok: false, error: "A filter needs a value." };
      }
      config.filters.push({ attribute: item.attribute, op: item.op as FilterOp, value: needsValue ? (item.value as string).trim() : undefined });
    }
  }

  if (input.sort !== undefined) {
    if (typeof input.sort !== "string" || !(SORT_CORE.has(input.sort) || SLUG.test(input.sort))) return { ok: false, error: "The sort column isn't valid." };
    config.sort = input.sort;
  }
  if (input.widths !== undefined) {
    if (!input.widths || typeof input.widths !== "object" || Array.isArray(input.widths)) return { ok: false, error: "Column widths aren't valid." };
    const entries = Object.entries(input.widths as Record<string, unknown>);
    if (entries.length > MAX_VIEW_COLUMNS + 1) return { ok: false, error: "Too many column widths." };
    const widths: Record<string, number> = {};
    for (const [slug, w] of entries) {
      if (!(slug === "name" || SLUG.test(slug)) || typeof w !== "number" || !Number.isFinite(w)) return { ok: false, error: "A column width isn't valid." };
      widths[slug] = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(w)));
    }
    config.widths = widths;
  }
  if (input.direction !== undefined) {
    if (input.direction !== "asc" && input.direction !== "desc") return { ok: false, error: "Sort direction must be asc or desc." };
    config.direction = input.direction;
  }
  return { ok: true, config };
}

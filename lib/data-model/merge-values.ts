import type { AttributeDef } from "./types";

/**
 * The values of two records being merged into one. The winner's value wins every clash; a value
 * only the loser has is kept; a multi-value field (emails, phones, domains, several-option selects)
 * becomes the union, winner's first, so no address is lost. Pure: used by the merge route and tested
 * in merge-values.test.mts.
 */
export function mergeValues(
  attrs: AttributeDef[],
  winner: Record<string, unknown>,
  loser: Record<string, unknown>
): Record<string, unknown> {
  const multi = new Set(attrs.filter((a) => a.is_multi || a.type === "multi_select").map((a) => a.slug));
  const out: Record<string, unknown> = { ...loser, ...winner };

  for (const slug of multi) {
    const w = winner[slug];
    const l = loser[slug];
    const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
    const seen = new Set<string>();
    const union = [...list(w), ...list(l)].filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (union.length) out[slug] = union;
    else delete out[slug];
  }

  // A single-value field the winner has empty falls back to the loser's.
  for (const [slug, v] of Object.entries(winner)) {
    if (multi.has(slug)) continue;
    if (v === undefined || v === null || v === "") out[slug] = loser[slug] ?? v;
  }
  for (const slug of Object.keys(out)) if (out[slug] === undefined || out[slug] === null) delete out[slug];
  return out;
}

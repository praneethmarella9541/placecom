/**
 * Pure matching logic for duplicate detection (lib/data-model/duplicates.ts does the database
 * side) — no "server-only", so this is what the tests exercise directly.
 */

/** The text a field's value is matched on. `null` means "nothing to match yet" — a rule with any
 *  such field never fires, since a blank field can't meaningfully identify a duplicate. */
export function normalizeForMatch(value: unknown, matchType: "exact" | "normalized"): string | null {
  if (value === null || value === undefined) return null;
  const text = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).sort().join("\u0001")
    : typeof value === "string"
      ? value.trim()
      : String(value);
  if (!text) return null;
  return matchType === "normalized" ? text.toLowerCase() : text;
}

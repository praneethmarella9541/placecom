/**
 * A workflow variable path like "trigger.record.values.score" as a formula-safe flat identifier:
 * trigger_record_values_score. The formula engine reads a dot as a cross-record hop, which this
 * isn't, so a path is offered to a condition formula under this flattened name instead (see
 * lib/workflows/condition-formula.ts). Zero dependencies — safe to import from a "use client"
 * component for the builder's reference list, unlike condition-formula.ts itself, which pulls in
 * lib/rules-engine (and, through it, node:vm — fine in blocks.ts, which runs only on the server,
 * but not something webpack can put in a browser bundle).
 */
export function variablePathToSlug(path: string): string {
  return path.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=[0-9])/, "_");
}

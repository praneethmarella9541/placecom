import type { FormulaValue } from "./types";

/**
 * What a formula is evaluated against. Built by the validation service (lib/data-model, phase 2) —
 * this module never touches a database; `resolveLink` is the one hook that does, supplied by the
 * caller so the engine itself stays pure and synchronously testable wherever it can be.
 */
export type EvalContext = {
  /** The record's own field values after the save being checked, keyed by attribute slug (plus "Name"). */
  values: Record<string, FormulaValue>;
  /** The record's values before this save. Undefined on create. */
  priorValues?: Record<string, FormulaValue>;
  isNew: boolean;
  user: { id: string; role: "admin" | "staff"; groupName: string | null; email: string; emailDomain: string };
  workspace: { id: string; name: string };
  /** Injected so TODAY()/NOW() are deterministic in tests; defaults to `new Date()` at call time. */
  now: Date;
  /** IANA zone TODAY()/YEAR()/MONTH()/DAY()/WEEKDAY() read calendar fields in. Default "Asia/Kolkata". */
  timeZone: string;
  /**
   * Reads one more hop across a record_ref/member field: path is everything after the local field,
   * e.g. for `traveller.company.industry` this is called with (["company","industry"], travellerId).
   * Returns undefined when the link is empty or the target doesn't exist. The caller enforces the
   * hop cap, the per-save read cap, and the current user's own read permission on the target —
   * this function is trusted to already reflect all three.
   */
  resolveLink: (path: string[], fromId: string) => Promise<FormulaValue> | FormulaValue;
};

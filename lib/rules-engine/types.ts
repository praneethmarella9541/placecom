/**
 * Shared types for the formula engine: pure, no database, no framework. A formula is parsed once
 * into an AST against a field schema (so unknown fields and type errors are caught at save time,
 * not at evaluation time), then evaluated any number of times against a record.
 */

/**
 * The value types a formula can produce or consume. "currency" is a "number" with the platform's
 * rounding rule applied at comparison time (see lib/rules-engine/functions.ts money()). "list" is a
 * multi_select/multi-value field's array of strings — the only non-scalar shape, so INCLUDES() has
 * something to search. "any" is only ever a static type (context fields, and IF/CASE branches whose
 * two sides don't match) — no value is ever tagged "any" at runtime.
 */
export type FormulaType = "text" | "number" | "boolean" | "date" | "datetime" | "list" | "null" | "any";

export type FormulaValue = string | number | boolean | Date | string[] | null;

/** A runtime value, tagged with the static type it was produced as — functions need both. */
export type Typed = { value: FormulaValue; type: FormulaType };

/** A position in the source text, for pointing an error at the right place. */
export type Position = { start: number; end: number };

export class FormulaError extends Error {
  pos: Position;
  constructor(message: string, pos: Position) {
    super(message);
    this.name = "FormulaError";
    this.pos = pos;
  }
}

/** One field a formula may reference, as the type-checker needs to know it. */
export type FieldSchema = {
  type: FormulaType;
  isMulti?: boolean;
  /** select / multi_select: the allowed option strings, for ISPICKVAL/INCLUDES literal checks. */
  options?: string[];
  /** record_ref / member: the schema of the object this field points at, for one more hop (Traveller.Company.Industry). */
  link?: ObjectSchema;
};

/** The fields a formula on one object may read: its own fields, plus "Name" for the record name. */
export type ObjectSchema = Record<string, FieldSchema>;

/** Maximum hops across record_ref/member fields a field path may take (A.B.C is 2 hops). */
export const MAX_LINK_DEPTH = 2;

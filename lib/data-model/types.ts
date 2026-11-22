/**
 * Flexible data model — shared types. Mirrors migration 0086.
 * Pure types: safe to import from the browser and from node's test runner.
 */

export const ATTRIBUTE_TYPES = [
  "text",
  "long_text",
  "number",
  "currency",
  "checkbox",
  "date",
  "timestamp",
  "rating",
  "select",
  "multi_select",
  "email",
  "phone",
  "url",
  "domain",
  "record_ref",
  "member",
] as const;

export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

/** What an attribute stores. Select options are plain strings in version 1. */
export type AttributeConfig = {
  options?: string[];
  /** record_ref: slug of the object the reference points at (people, companies, ...). */
  target_object?: string;
  /** currency: ISO code shown next to the number. */
  currency?: string;
  /** rating: top of the scale (number, default 5). number/currency: maximum allowed value (number).
   *  date: latest allowed day (an ISO or otherwise parseable date string). */
  max?: number | string;
  /** number/currency: minimum allowed value (number). date: earliest allowed day (date string). */
  min?: number | string;
  /** text/long_text: minimum character length. */
  minLength?: number;
  /** text/long_text: maximum character length — still capped by the field type's own hard limit. */
  maxLength?: number;
  /** text-like types: a regex the value must fully match. */
  pattern?: string;
  /** Shown instead of the generic "doesn't match the pattern" message when `pattern` fails. */
  patternMessage?: string;
  /** select/multi_select: the slug of another select field on the same object whose chosen value
   *  decides which of THIS field's own options are allowed (dependentOptions). */
  controlledBy?: string;
  /** select/multi_select: controlling field's option value -> the subset of this field's own
   *  options allowed when that's chosen. A controlling value with no entry here allows none of
   *  this field's options — an unmapped combination is refused, not silently let through. */
  dependentOptions?: Record<string, string[]>;
  /** member: restrict the picker (and enforce on save) to team members in this access group id. */
  memberGroupId?: string;
  /** record_ref: this field's value must point at a record whose `lookupMatchField` equals THIS
   *  record's own `lookupMatchSource` field — e.g. "Traveller must be in the same company": a link
   *  field's target must share a value with one of this record's own fields. */
  lookupMatchSource?: string;
  lookupMatchField?: string;
  /** Filled in for a new record that leaves this field out. Already normalised for the field's type. */
  default?: unknown;
};

export type AttributeDef = {
  id?: string;
  slug: string;
  name: string;
  type: AttributeType;
  is_multi: boolean;
  config: AttributeConfig;
  is_system?: boolean;
  is_required: boolean;
  is_unique: boolean;
  position?: number;
  archived_at?: string | null;
  /** Set for an attribute of a list's entries rather than of the record. */
  list_id?: string | null;
};

export type StaffAccess = "none" | "read" | "write";

export type ObjectDef = {
  id: string;
  slug: string;
  singular_name: string;
  plural_name: string;
  is_system: boolean;
  position: number;
  /** What staff (non-admins) may do with this object. Admins always have full access. */
  staff_access?: StaffAccess;
  /** Up to six field slugs shown at the top of every record page. */
  highlights?: string[];
};

export type RecordRow = {
  id: string;
  object_id: string;
  name: string;
  values: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/** A key that identifies a record and must be unique per org and object. */
export type RecordKey = { kind: "email" | "domain"; value: string };

export type FilterOp = "eq" | "neq" | "contains" | "before" | "after" | "empty" | "not_empty";

export type RecordFilter = {
  /** An attribute slug, or "name". */
  attribute: string;
  op: FilterOp;
  value?: string;
};

export type RecordSort = { attribute: string; direction: "asc" | "desc" };

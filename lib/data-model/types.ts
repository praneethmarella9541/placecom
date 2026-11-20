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
  /** rating: top of the scale; default 5. */
  max?: number;
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

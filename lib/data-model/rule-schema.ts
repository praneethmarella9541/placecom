import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_LINK_DEPTH, type FieldSchema, type FormulaType, type ObjectSchema } from "../rules-engine/index";
import { loadAttributes, loadObject } from "./records";
import type { AttributeDef, AttributeType } from "./types";

/**
 * Turns an object's attributes into the schema lib/rules-engine's type checker and evaluator read
 * field types from. `record_ref` fields get one more hop resolved recursively (capped at
 * MAX_LINK_DEPTH, so `A.B.C` is the deepest a formula can ever reach) by loading the target
 * object's own attributes; `member` fields point at `profiles`, which has no formula schema of its
 * own in version 1, so they don't get a `.link` — a bare `agent` field still works as a plain id.
 */

const ATTR_TYPE_TO_FORMULA: Record<AttributeType, FormulaType> = {
  text: "text",
  long_text: "text",
  email: "text",
  phone: "text",
  url: "text",
  domain: "text",
  select: "text",
  number: "number",
  currency: "number",
  rating: "number",
  checkbox: "boolean",
  date: "date",
  timestamp: "datetime",
  multi_select: "text", // isMulti below makes the field's actual type "list"; this is the element type
  record_ref: "text", // the stored value is the linked record's id
  member: "text", // the stored value is a profile id
};

export async function buildObjectSchema(
  svc: SupabaseClient,
  org: string,
  attrs: AttributeDef[],
  depth: number = MAX_LINK_DEPTH
): Promise<ObjectSchema> {
  const schema: ObjectSchema = { Name: { type: "text" } };
  for (const attr of attrs) {
    if (attr.archived_at) continue;
    const field: FieldSchema = {
      type: ATTR_TYPE_TO_FORMULA[attr.type],
      isMulti: attr.is_multi || attr.type === "multi_select",
      options: attr.config.options,
    };
    if (attr.type === "record_ref" && attr.config.target_object && depth > 0) {
      const target = await loadObject(svc, org, attr.config.target_object);
      if (target) {
        const targetAttrs = await loadAttributes(svc, org, target.id);
        field.link = await buildObjectSchema(svc, org, targetAttrs, depth - 1);
      }
    }
    schema[attr.slug] = field;
  }
  return schema;
}

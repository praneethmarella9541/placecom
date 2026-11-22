import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { compileExpression } from "../rules-engine/index";
import { buildObjectSchema } from "./rule-schema";
import type { AttributeDef } from "./types";

/**
 * Checks a formula rule's shape before it's ever saved: a formula must compile AND evaluate to
 * TRUE/FALSE (it's an error CONDITION — "this is true" means the record is invalid), the API name
 * must look like one and be free within this object, and error_location (if set) must name a real
 * field. Anything wrong here is a save-time error with a message and, for the formula itself, the
 * exact position to point at — never something discovered the first time a record happens to hit it.
 */

const API_NAME = /^[a-z][a-z0-9_]{0,59}$/;
const MAX_MESSAGE = 500;
const MAX_DESCRIPTION = 2000;
const MAX_SOURCE = 4000;

export type FormulaRuleInput = {
  apiName: string;
  description?: string | null;
  appliesOn: "create" | "update" | "both";
  mode: "block" | "warn";
  errorLocation?: string | null;
  message?: string | null;
  expressionSource: string;
};

export type FormulaRuleRow = {
  format: "formula";
  api_name: string;
  description: string | null;
  applies_on: "create" | "update" | "both";
  mode: "block" | "warn";
  error_location: string | null;
  message: string | null;
  expression_source: string;
  expression_ast: unknown;
};

export type FormulaValidation = { ok: true; row: FormulaRuleRow } | { ok: false; error: string; pos?: { start: number; end: number } };

/** Checks everything about a formula rule except that its api_name is free — the caller already
 *  knows the object and whether this is an update to a specific row, so it checks uniqueness itself. */
export async function validateFormulaRule(svc: SupabaseClient, org: string, attrs: AttributeDef[], input: unknown): Promise<FormulaValidation> {
  const body = (input ?? {}) as Partial<Record<keyof FormulaRuleInput, unknown>>;

  const apiName = typeof body.apiName === "string" ? body.apiName.trim() : "";
  if (!API_NAME.test(apiName)) {
    return { ok: false, error: "The API name must start with a lowercase letter and contain only lowercase letters, numbers and underscores (up to 60 characters)." };
  }

  const description = body.description === undefined || body.description === null ? null : String(body.description).trim().slice(0, MAX_DESCRIPTION) || null;

  const appliesOn = body.appliesOn === "create" || body.appliesOn === "update" ? body.appliesOn : "both";
  const mode = body.mode === "warn" ? "warn" : "block";

  let errorLocation: string | null = null;
  if (body.errorLocation !== undefined && body.errorLocation !== null && body.errorLocation !== "") {
    const slug = String(body.errorLocation).trim();
    if (slug !== "name" && !attrs.some((a) => !a.archived_at && a.slug === slug)) {
      return { ok: false, error: `"${slug.slice(0, 40)}" isn't a field on this object.` };
    }
    errorLocation = slug;
  }

  const message = typeof body.message === "string" && body.message.trim() ? body.message.trim().slice(0, MAX_MESSAGE) : null;

  const expressionSource = typeof body.expressionSource === "string" ? body.expressionSource.trim() : "";
  if (!expressionSource) return { ok: false, error: "Give the rule a formula." };
  if (expressionSource.length > MAX_SOURCE) return { ok: false, error: `The formula is longer than ${MAX_SOURCE} characters.` };

  const schema = await buildObjectSchema(svc, org, attrs);
  const compiled = compileExpression(expressionSource, schema);
  if (!compiled.ok) return { ok: false, error: compiled.error, pos: compiled.pos };
  if (compiled.returnType !== "boolean" && compiled.returnType !== "any" && compiled.returnType !== "null") {
    return { ok: false, error: `This formula works out to a ${compiled.returnType}, not TRUE or FALSE — it needs to say when the record is invalid.` };
  }

  return {
    ok: true,
    row: {
      format: "formula",
      api_name: apiName,
      description,
      applies_on: appliesOn,
      mode,
      error_location: errorLocation,
      message,
      expression_source: expressionSource,
      expression_ast: compiled.ast,
    },
  };
}

/** True if another rule on this object already uses this API name (excluding `excludeId` on an update). */
export async function apiNameTaken(svc: SupabaseClient, org: string, objectId: string, apiName: string, excludeId?: string): Promise<boolean> {
  let q = svc.from("data_validation_rules").select("id", { count: "exact", head: true }).eq("org_owner_id", org).eq("object_id", objectId).eq("api_name", apiName);
  if (excludeId) q = q.neq("id", excludeId);
  const { count, error } = await q;
  return !error && (count ?? 0) > 0;
}

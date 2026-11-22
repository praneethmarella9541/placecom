import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dbErrorMessage } from "@/lib/api-error";
import { slugify } from "./lists";
import { invalidateModelCache, loadAttributes, loadObject } from "./records";
import { ATTRIBUTE_TYPES, type AttributeConfig, type AttributeDef, type AttributeType } from "./types";
import { isEmptyInput, normalizeValue } from "./values";

/**
 * Adding, renaming and hiding fields. Shared by the object routes (a field on every record) and
 * the list routes (a field on each entry of one list), which differ only in `listId`.
 */

const RESERVED = new Set(["name", "id", "created_at", "updated_at"]);
export const MAX_ATTRIBUTES = 60;

export type AttributeFailure = { ok: false; status: number; error: string };
export type AttributeInput = {
  name?: unknown;
  archived?: unknown;
  type?: unknown;
  isMulti?: unknown;
  options?: unknown;
  targetObject?: unknown;
  currency?: unknown;
  isRequired?: unknown;
  defaultValue?: unknown;
  min?: unknown;
  max?: unknown;
  minLength?: unknown;
  maxLength?: unknown;
  pattern?: unknown;
  patternMessage?: unknown;
};

/** Reads min/max/minLength/maxLength/pattern/patternMessage off a request body into a field's
 *  config, type-checked against what the field type actually uses them for. Shared by create and
 *  update so a constraint means the same thing and is checked the same way in both places. */
function applyConstraints(type: AttributeType, body: AttributeInput, config: AttributeConfig): { ok: true } | { ok: false; error: string } {
  const isNumeric = type === "number" || type === "currency";
  const isDate = type === "date";
  const isTextLike = type === "text" || type === "long_text" || type === "email" || type === "phone" || type === "url" || type === "domain";

  if (body.min !== undefined) {
    if (!isNumeric && !isDate) return { ok: false, error: "A minimum only applies to a number, currency or date field." };
    if (isNumeric) {
      const n = Number(body.min);
      if (body.min !== null && (!Number.isFinite(n) || typeof body.min === "boolean")) return { ok: false, error: "Minimum must be a number." };
      if (body.min === null) delete config.min;
      else config.min = n;
    } else {
      if (body.min !== null && typeof body.min !== "string") return { ok: false, error: "Minimum must be a date." };
      if (body.min === null) delete config.min;
      else config.min = body.min;
    }
  }
  if (body.max !== undefined) {
    if (!isNumeric && !isDate && type !== "rating") return { ok: false, error: "A maximum only applies to a number, currency, date or rating field." };
    if (isNumeric || type === "rating") {
      const n = Number(body.max);
      if (body.max !== null && (!Number.isFinite(n) || typeof body.max === "boolean")) return { ok: false, error: "Maximum must be a number." };
      if (body.max === null) delete config.max;
      else config.max = n;
    } else {
      if (body.max !== null && typeof body.max !== "string") return { ok: false, error: "Maximum must be a date." };
      if (body.max === null) delete config.max;
      else config.max = body.max;
    }
  }
  if (typeof config.min === "number" && typeof config.max === "number" && config.min > config.max) {
    return { ok: false, error: "Minimum can't be more than maximum." };
  }
  if (typeof config.min === "string" && typeof config.max === "string" && config.min > config.max) {
    return { ok: false, error: "Minimum date can't be after the maximum date." };
  }

  if (body.minLength !== undefined) {
    if (!isTextLike) return { ok: false, error: "A minimum length only applies to a text field." };
    if (body.minLength === null) delete config.minLength;
    else {
      const n = Number(body.minLength);
      if (!Number.isInteger(n) || n < 0) return { ok: false, error: "Minimum length must be a whole number." };
      config.minLength = n;
    }
  }
  if (body.maxLength !== undefined) {
    if (!isTextLike) return { ok: false, error: "A maximum length only applies to a text field." };
    if (body.maxLength === null) delete config.maxLength;
    else {
      const n = Number(body.maxLength);
      if (!Number.isInteger(n) || n < 1) return { ok: false, error: "Maximum length must be a whole number." };
      config.maxLength = n;
    }
  }
  if (typeof config.minLength === "number" && typeof config.maxLength === "number" && config.minLength > config.maxLength) {
    return { ok: false, error: "Minimum length can't be more than maximum length." };
  }

  if (body.pattern !== undefined) {
    if (!isTextLike) return { ok: false, error: "A pattern only applies to a text field." };
    if (body.pattern === null || body.pattern === "") {
      delete config.pattern;
      delete config.patternMessage;
    } else {
      if (typeof body.pattern !== "string" || body.pattern.length > 200) return { ok: false, error: "The pattern is too long." };
      try {
        new RegExp(body.pattern);
      } catch {
        return { ok: false, error: "That isn't a valid pattern." };
      }
      config.pattern = body.pattern;
    }
  }
  if (body.patternMessage !== undefined) {
    if (typeof body.patternMessage === "string" && body.patternMessage.trim()) config.patternMessage = body.patternMessage.trim().slice(0, 200);
    else delete config.patternMessage;
  }
  return { ok: true };
}

const COLUMNS = "id, slug, name, type, is_multi, config, is_system, is_required, is_unique, position, archived_at, list_id";

export async function createAttribute(
  svc: SupabaseClient,
  org: string,
  objectId: string,
  listId: string | null,
  body: AttributeInput | null
): Promise<{ ok: true; attribute: AttributeDef } | AttributeFailure> {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!body || !name || name.length > 60) return { ok: false, status: 400, error: "Name must be 1 to 60 characters." };
  if (typeof body.type !== "string" || !(ATTRIBUTE_TYPES as readonly string[]).includes(body.type)) {
    return { ok: false, status: 400, error: "Unknown type." };
  }
  const type = body.type as AttributeType;

  const config: AttributeConfig = {};
  if (type === "select" || type === "multi_select") {
    const options = (Array.isArray(body.options) ? body.options : [])
      .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      .map((o) => o.trim().slice(0, 60));
    const unique = [...new Map(options.map((o) => [o.toLowerCase(), o])).values()];
    if (unique.length === 0) return { ok: false, status: 400, error: "Add at least one option." };
    if (unique.length > 50) return { ok: false, status: 400, error: "No more than 50 options." };
    config.options = unique;
  }
  if (type === "record_ref") {
    const target = typeof body.targetObject === "string" ? await loadObject(svc, org, body.targetObject) : null;
    if (!target) return { ok: false, status: 400, error: "Choose which kind of record this points at." };
    config.target_object = target.slug;
  }
  if (type === "currency") config.currency = typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency) ? body.currency : "INR";

  const constraints = applyConstraints(type, body, config);
  if (!constraints.ok) return { ok: false, status: 400, error: constraints.error };

  // A default is checked like any value for this field, so every new record starts valid.
  if (body.defaultValue !== undefined && !isEmptyInput(body.defaultValue)) {
    const probe: AttributeDef = { slug: "default", name, type, is_multi: body.isMulti === true, config, is_required: false, is_unique: false };
    const norm = normalizeValue(probe, body.defaultValue);
    if (!norm.ok) return { ok: false, status: 400, error: `Default value: ${norm.error.replace(/^[^:]*: /, "")}` };
    if (norm.value !== null) config.default = norm.value;
  }

  const existing = await loadAttributes(svc, org, objectId, listId);
  if (existing.length >= MAX_ATTRIBUTES) {
    return { ok: false, status: 400, error: `There can be at most ${MAX_ATTRIBUTES} fields here.` };
  }
  const position = Math.max(0, ...existing.map((a) => a.position ?? 0)) + 1;

  // Slug from the name; on a clash (archived fields count) try name_2, name_3 ...
  let base = slugify(name);
  if (RESERVED.has(base)) base = `${base}_field`;
  for (let attempt = 1; attempt <= 20; attempt++) {
    const slug = attempt === 1 ? base : `${base.slice(0, 36)}_${attempt}`;
    const { data, error } = await svc
      .from("data_attributes")
      .insert({
        org_owner_id: org,
        object_id: objectId,
        list_id: listId,
        slug,
        name,
        type,
        is_multi: type !== "multi_select" && body.isMulti === true && !["checkbox", "rating", "long_text"].includes(type),
        config,
        is_required: body.isRequired === true,
        position,
      })
      .select(COLUMNS)
      .single();
    if (!error) {
      invalidateModelCache();
      return { ok: true, attribute: data as AttributeDef };
    }
    if (error.code !== "23505") return { ok: false, status: 500, error: dbErrorMessage(error) };
  }
  return { ok: false, status: 409, error: "Couldn't find a free name for that field." };
}

export async function updateAttribute(
  svc: SupabaseClient,
  org: string,
  objectId: string,
  listId: string | null,
  attrSlug: string,
  body: AttributeInput | null
): Promise<{ ok: true } | AttributeFailure> {
  let q = svc.from("data_attributes").select("id, is_system, name, type, is_multi, config").eq("org_owner_id", org).eq("object_id", objectId).eq("slug", attrSlug);
  q = listId ? q.eq("list_id", listId) : q.is("list_id", null);
  const { data: attr } = await q.maybeSingle();
  if (!attr) return { ok: false, status: 404, error: "Not found." };
  if (attr.is_system) return { ok: false, status: 400, error: "Built-in fields can't be changed." };

  const patch: Record<string, unknown> = {};
  if (body?.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 60) return { ok: false, status: 400, error: "Name must be 1 to 60 characters." };
    patch.name = name;
  }
  if (body?.archived !== undefined) patch.archived_at = body.archived === true ? new Date().toISOString() : null;
  if (body?.isRequired !== undefined) patch.is_required = body.isRequired === true;

  const CONSTRAINT_KEYS = ["min", "max", "minLength", "maxLength", "pattern", "patternMessage"] as const;
  if (body && (body.defaultValue !== undefined || CONSTRAINT_KEYS.some((k) => body[k] !== undefined))) {
    const config = { ...((attr.config as AttributeConfig | null) ?? {}) };
    const constraints = applyConstraints(attr.type as AttributeType, body, config);
    if (!constraints.ok) return { ok: false, status: 400, error: constraints.error };

    if (body.defaultValue !== undefined) {
      if (isEmptyInput(body.defaultValue)) delete config.default;
      else {
        const probe: AttributeDef = { slug: "default", name: attr.name as string, type: attr.type as AttributeType, is_multi: attr.is_multi as boolean, config, is_required: false, is_unique: false };
        const norm = normalizeValue(probe, body.defaultValue);
        if (!norm.ok) return { ok: false, status: 400, error: `Default value: ${norm.error.replace(/^[^:]*: /, "")}` };
        if (norm.value === null) delete config.default;
        else config.default = norm.value;
      }
    }
    patch.config = config;
  }
  if (!Object.keys(patch).length) return { ok: false, status: 400, error: "Nothing to change." };

  const { error } = await svc.from("data_attributes").update(patch).eq("org_owner_id", org).eq("id", attr.id);
  if (error) return { ok: false, status: 500, error: dbErrorMessage(error) };
  invalidateModelCache();
  return { ok: true };
}

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
  controlledBy?: unknown;
  dependentOptions?: unknown;
  memberGroupId?: unknown;
  lookupMatchSource?: unknown;
  lookupMatchField?: unknown;
};

/** Reads min/max/minLength/maxLength/pattern/patternMessage/controlledBy/dependentOptions/
 *  memberGroupId/lookupMatchSource/lookupMatchField off a request body into a field's config,
 *  type-checked against what the field type actually uses them for, and (for the two lookup-style
 *  settings) checked against the database — a group id that doesn't exist, or a target field that
 *  isn't real, is refused at save time rather than silently matching nothing forever. Shared by
 *  create and update so a constraint means the same thing and is checked the same way in both
 *  places; `svc`/`org`/`objectId`/`ownSlug` are only used by the two DB-backed checks. */
async function applyConstraints(
  svc: SupabaseClient,
  org: string,
  objectId: string,
  ownSlug: string | null,
  attrs: AttributeDef[],
  type: AttributeType,
  body: AttributeInput,
  config: AttributeConfig
): Promise<{ ok: true } | { ok: false; error: string }> {
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

  const isSelectLike = type === "select" || type === "multi_select";
  if (body.controlledBy !== undefined) {
    if (!isSelectLike) return { ok: false, error: "Only a select field can depend on another field." };
    if (body.controlledBy === null || body.controlledBy === "") {
      delete config.controlledBy;
      delete config.dependentOptions;
    } else {
      if (typeof body.controlledBy !== "string") return { ok: false, error: "Choose a field this depends on." };
      const controlling = attrs.find((a) => a.slug === body.controlledBy && !a.archived_at);
      if (!controlling || controlling.slug === ownSlug) return { ok: false, error: "Choose a real field other than this one." };
      if (controlling.type !== "select" && controlling.type !== "multi_select") return { ok: false, error: "A field can only depend on another select field." };
      config.controlledBy = controlling.slug;
    }
  }
  if (body.dependentOptions !== undefined) {
    if (!isSelectLike) return { ok: false, error: "Only a select field can have dependent options." };
    if (!config.controlledBy) return { ok: false, error: "Choose the field this depends on first." };
    if (body.dependentOptions === null) delete config.dependentOptions;
    else {
      if (typeof body.dependentOptions !== "object" || Array.isArray(body.dependentOptions)) {
        return { ok: false, error: "Dependent options must map each controlling value to a list of options." };
      }
      const ownOptions = new Set((config.options ?? []).map((o) => o.toLowerCase()));
      const map: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(body.dependentOptions as Record<string, unknown>).slice(0, 200)) {
        if (!Array.isArray(value)) return { ok: false, error: `The allowed options for "${key.slice(0, 40)}" must be a list.` };
        const allowed = value.filter((o): o is string => typeof o === "string" && ownOptions.has(o.toLowerCase()));
        if (allowed.length !== value.length) return { ok: false, error: `One of the options for "${key.slice(0, 40)}" isn't one of this field's own options.` };
        map[key.slice(0, 60)] = allowed;
      }
      config.dependentOptions = map;
    }
  }

  if (body.memberGroupId !== undefined) {
    if (type !== "member") return { ok: false, error: "An access-group filter only applies to a team-member field." };
    if (body.memberGroupId === null || body.memberGroupId === "") delete config.memberGroupId;
    else {
      if (typeof body.memberGroupId !== "string") return { ok: false, error: "Choose an access group." };
      const { data } = await svc.from("team_groups").select("id").eq("org_owner_id", org).eq("id", body.memberGroupId).maybeSingle();
      if (!data) return { ok: false, error: "Unknown access group." };
      config.memberGroupId = body.memberGroupId;
    }
  }

  if (body.lookupMatchSource !== undefined || body.lookupMatchField !== undefined) {
    if (type !== "record_ref") return { ok: false, error: "A lookup filter only applies to a link field." };
    if (body.lookupMatchSource === null || body.lookupMatchSource === "") {
      delete config.lookupMatchSource;
      delete config.lookupMatchField;
    } else {
      const source = typeof body.lookupMatchSource === "string" ? attrs.find((a) => a.slug === body.lookupMatchSource && !a.archived_at && a.slug !== ownSlug) : null;
      if (!source) return { ok: false, error: "Choose a real field on this object to match against." };
      const targetSlug = config.target_object;
      if (!targetSlug) return { ok: false, error: "Choose what this field points at first." };
      const target = await loadObject(svc, org, targetSlug);
      const targetAttrs = target ? await loadAttributes(svc, org, target.id) : [];
      const field = typeof body.lookupMatchField === "string" ? targetAttrs.find((a) => a.slug === body.lookupMatchField && !a.archived_at) : null;
      if (!field) return { ok: false, error: `Choose a field on the linked object to match ${source.name} against.` };
      config.lookupMatchSource = source.slug;
      config.lookupMatchField = field.slug;
    }
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

  const existing = await loadAttributes(svc, org, objectId, listId);

  const constraints = await applyConstraints(svc, org, objectId, null, existing, type, body, config);
  if (!constraints.ok) return { ok: false, status: 400, error: constraints.error };

  // A default is checked like any value for this field, so every new record starts valid.
  if (body.defaultValue !== undefined && !isEmptyInput(body.defaultValue)) {
    const probe: AttributeDef = { slug: "default", name, type, is_multi: body.isMulti === true, config, is_required: false, is_unique: false };
    const norm = normalizeValue(probe, body.defaultValue);
    if (!norm.ok) return { ok: false, status: 400, error: `Default value: ${norm.error.replace(/^[^:]*: /, "")}` };
    if (norm.value !== null) config.default = norm.value;
  }

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

  const CONSTRAINT_KEYS = [
    "min", "max", "minLength", "maxLength", "pattern", "patternMessage",
    "controlledBy", "dependentOptions", "memberGroupId", "lookupMatchSource", "lookupMatchField",
  ] as const;
  if (body && (body.defaultValue !== undefined || CONSTRAINT_KEYS.some((k) => body[k] !== undefined))) {
    const config = { ...((attr.config as AttributeConfig | null) ?? {}) };
    const siblings = await loadAttributes(svc, org, objectId, listId);
    const constraints = await applyConstraints(svc, org, objectId, attrSlug, siblings, attr.type as AttributeType, body, config);
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

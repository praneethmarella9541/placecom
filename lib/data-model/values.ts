import type { AttributeDef, RecordKey } from "./types";

/**
 * Turns whatever a client sent into the one shape each attribute type stores, or says why it can't.
 * Pure: no database, no framework. Used by the API routes before anything is written, and by the
 * tests in values.test.mts.
 *
 * Storage shape (what lands in data_records.values, keyed by attribute slug):
 *   single attribute  -> the scalar, or absent when empty
 *   multi attribute   -> a non-empty array of scalars, or absent when empty
 * An empty value is never stored: clearing a field removes its key.
 */

export type Normalized = { ok: true; value: unknown } | { ok: false; error: string };

const TEXT_MAX = 500;
const LONG_TEXT_MAX = 20000;
const MULTI_MAX = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>()[\],;:"]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** True for "nothing was entered": null, undefined, blank text, or an empty list. */
export function isEmptyInput(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === "string") return raw.trim() === "";
  if (Array.isArray(raw)) return raw.every(isEmptyInput);
  return false;
}

function fail(attr: AttributeDef, why: string): Normalized {
  return { ok: false, error: `${attr.name}: ${why}` };
}

function scalar(attr: AttributeDef, raw: unknown): Normalized {
  switch (attr.type) {
    case "text":
    case "long_text": {
      if (typeof raw !== "string") return fail(attr, "must be text.");
      const text = raw.trim();
      const max = attr.type === "text" ? TEXT_MAX : LONG_TEXT_MAX;
      if (text.length > max) return fail(attr, `is longer than ${max} characters.`);
      return { ok: true, value: text };
    }
    case "number":
    case "currency": {
      const n = typeof raw === "string" ? Number(raw.trim().replace(/,/g, "")) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return fail(attr, "must be a number.");
      if (Math.abs(n) > 1e15) return fail(attr, "is too large.");
      return { ok: true, value: n };
    }
    case "checkbox": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true") return { ok: true, value: true };
      if (raw === "false") return { ok: true, value: false };
      return fail(attr, "must be true or false.");
    }
    case "date": {
      if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
        return fail(attr, "must be a date like 2026-12-31.");
      }
      const d = new Date(`${raw.trim()}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw.trim()) {
        return fail(attr, "is not a real date.");
      }
      return { ok: true, value: raw.trim() };
    }
    case "timestamp": {
      if (typeof raw !== "string" && typeof raw !== "number") return fail(attr, "must be a date and time.");
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return fail(attr, "is not a valid date and time.");
      return { ok: true, value: d.toISOString() };
    }
    case "rating": {
      const max = attr.config.max && attr.config.max > 0 ? attr.config.max : 5;
      const n = typeof raw === "string" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > max) {
        return fail(attr, `must be a whole number from 1 to ${max}.`);
      }
      return { ok: true, value: n };
    }
    case "select":
    case "multi_select": {
      if (typeof raw !== "string") return fail(attr, "must be one of the options.");
      const options = attr.config.options ?? [];
      const hit = options.find((o) => o.toLowerCase() === raw.trim().toLowerCase());
      if (!hit) return fail(attr, `"${raw.trim().slice(0, 40)}" is not one of the options.`);
      return { ok: true, value: hit };
    }
    case "email": {
      if (typeof raw !== "string") return fail(attr, "must be an email address.");
      const email = raw.trim().toLowerCase();
      if (email.length > 254 || !EMAIL.test(email)) return fail(attr, `"${raw.trim().slice(0, 60)}" is not an email address.`);
      return { ok: true, value: email };
    }
    case "phone": {
      if (typeof raw !== "string") return fail(attr, "must be a phone number.");
      const phone = raw.trim().replace(/[\s().-]/g, "");
      if (!/^\+?\d{6,15}$/.test(phone)) return fail(attr, `"${raw.trim().slice(0, 30)}" is not a phone number.`);
      return { ok: true, value: phone };
    }
    case "url": {
      if (typeof raw !== "string") return fail(attr, "must be a web address.");
      const text = raw.trim();
      let url: URL;
      try {
        url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
      } catch {
        return fail(attr, "is not a web address.");
      }
      // Only web links: a stored javascript: or data: URL would run when someone clicks it.
      if (url.protocol !== "http:" && url.protocol !== "https:") return fail(attr, "must start with http or https.");
      if (!url.hostname.includes(".")) return fail(attr, "is not a web address.");
      return { ok: true, value: url.toString() };
    }
    case "domain": {
      if (typeof raw !== "string") return fail(attr, "must be a domain like example.com.");
      const domain = raw
        .trim()
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
        .replace(/^www\./, "")
        .split(/[/?#]/)[0];
      if (domain.length > 253 || !DOMAIN.test(domain)) return fail(attr, `"${raw.trim().slice(0, 60)}" is not a domain.`);
      return { ok: true, value: domain };
    }
    case "record_ref":
    case "member": {
      if (typeof raw !== "string" || !UUID.test(raw.trim())) return fail(attr, "must be a record id.");
      return { ok: true, value: raw.trim().toLowerCase() };
    }
  }
}

/**
 * Normalizes one attribute's value. Returns `{ ok: true, value: null }` for an empty input, which
 * the caller treats as "clear this field".
 */
export function normalizeValue(attr: AttributeDef, raw: unknown): Normalized {
  if (isEmptyInput(raw)) return { ok: true, value: null };

  const multi = attr.is_multi || attr.type === "multi_select";
  if (!multi) {
    if (Array.isArray(raw)) return fail(attr, "takes a single value.");
    return scalar(attr, raw);
  }

  const items = Array.isArray(raw) ? raw : [raw];
  if (items.length > MULTI_MAX) return fail(attr, `has more than ${MULTI_MAX} values.`);
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (isEmptyInput(item)) continue;
    const one = scalar(attr, item);
    if (!one.ok) return one;
    const key = JSON.stringify(one.value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(one.value);
  }
  return { ok: true, value: out.length ? out : null };
}

export type RecordInput = { name?: unknown; values?: Record<string, unknown> };

export type ValidatedRecord =
  | { ok: true; name?: string; values: Record<string, unknown>; cleared: string[] }
  | { ok: false; errors: string[] };

/**
 * Checks a create or update body against the object's attributes.
 *
 *  - `create`: required attributes (and a name) must be present.
 *  - update: only the attributes sent are looked at; a null or blank value clears the field, and
 *    clearing a required one is refused.
 *
 * `values` in the result holds only what to set; `cleared` lists slugs to remove.
 */
export function validateRecordInput(
  attrs: AttributeDef[],
  input: RecordInput,
  mode: "create" | "update"
): ValidatedRecord {
  const errors: string[] = [];
  const bySlug = new Map(attrs.filter((a) => !a.archived_at).map((a) => [a.slug, a]));
  const values: Record<string, unknown> = {};
  const cleared: string[] = [];
  // Slugs already reported, so a bad value for a required field isn't also reported as missing.
  const reported = new Set<string>();

  let name: string | undefined;
  if (input.name !== undefined) {
    if (typeof input.name !== "string") errors.push("Name must be text.");
    else if (input.name.trim().length > TEXT_MAX) errors.push(`Name is longer than ${TEXT_MAX} characters.`);
    else name = input.name.trim();
  }
  if (mode === "create" && !name) errors.push("Name is required.");
  if (mode === "update" && name === "") errors.push("Name can't be empty.");

  const sent = input.values ?? {};
  if (typeof sent !== "object" || Array.isArray(sent)) {
    return { ok: false, errors: ["values must be an object."] };
  }
  for (const [slug, raw] of Object.entries(sent)) {
    const attr = bySlug.get(slug);
    if (!attr) {
      errors.push(`Unknown attribute "${slug.slice(0, 40)}".`);
      continue;
    }
    const result = normalizeValue(attr, raw);
    if (!result.ok) {
      errors.push(result.error);
      reported.add(slug);
      continue;
    }
    if (result.value === null) {
      if (attr.is_required) errors.push(`${attr.name}: is required.`);
      else cleared.push(slug);
    } else {
      values[slug] = result.value;
    }
  }

  if (mode === "create") {
    for (const attr of bySlug.values()) {
      if (attr.is_required && values[attr.slug] === undefined && !reported.has(attr.slug)) errors.push(`${attr.name}: is required.`);
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, name, values, cleared };
}

/** The matching keys a record's values produce: every email on an email attribute, every domain. */
export function extractKeys(attrs: AttributeDef[], values: Record<string, unknown>): RecordKey[] {
  const keys: RecordKey[] = [];
  const seen = new Set<string>();
  for (const attr of attrs) {
    if (!attr.is_unique || (attr.type !== "email" && attr.type !== "domain")) continue;
    const stored = values[attr.slug];
    const list = Array.isArray(stored) ? stored : stored === undefined || stored === null ? [] : [stored];
    for (const item of list) {
      if (typeof item !== "string" || !item) continue;
      const value = item.trim().toLowerCase();
      const id = `${attr.type}:${value}`;
      if (seen.has(id)) continue;
      seen.add(id);
      keys.push({ kind: attr.type, value });
    }
  }
  return keys;
}

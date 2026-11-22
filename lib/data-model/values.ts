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

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

/** `2026-12-31` if y/m/d is a real calendar day, otherwise null. */
function ymdToIso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Turns whatever a person typed or a spreadsheet exported as a date into `YYYY-MM-DD`, or says it
 * can't: ISO and `YYYY/MM/DD`-style, day/month/year or month/day/year with a 2- or 4-digit year
 * (`/`, `-` or `.` separated — ambiguous day-vs-month, e.g. "05/06/2026", is read as day-month-year,
 * the convention CSV exports from this platform's own market mostly use), and a named month in
 * either order ("31 Dec 2026", "December 31, 2026", "31st Dec '26"). A 2-digit year is read as
 * 2000-2068 or 1969-1999, matching the common spreadsheet convention.
 */
export function parseFlexibleDate(input: string): string | null {
  const s = input.trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  if (!s) return null;

  // Year first: 2026-12-31, 2026/12/31, 2026.12.31
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ymdToIso(+m[1], +m[2], +m[3]);

  const yearFromShort = (yy: string): number => {
    const n = +yy;
    return n <= 68 ? 2000 + n : 1900 + n;
  };

  // Year last, numeric: 31/12/2026, 12/31/2026, 31-12-26, 12.31.26
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const year = m[3].length === 4 ? +m[3] : yearFromShort(m[3]);
    if (a > 12 && b <= 12) return ymdToIso(year, b, a); // day/month/year
    if (b > 12 && a <= 12) return ymdToIso(year, a, b); // month/day/year
    return ymdToIso(year, b, a); // ambiguous — default day/month/year
  }

  // Named month, day first: 31 Dec 2026, 31-Dec-2026, 31 December, 2026
  m = s.match(/^(\d{1,2})[\s-]+([a-zA-Z]+)\.?,?[\s-]+(\d{4}|\d{2})$/);
  if (m) {
    const mon = MONTH_NAMES[m[2].toLowerCase()];
    if (mon) return ymdToIso(m[3].length === 4 ? +m[3] : yearFromShort(m[3]), mon, +m[1]);
  }

  // Named month, month first: Dec 31, 2026 / December 31 2026
  m = s.match(/^([a-zA-Z]+)\.?[\s,]+(\d{1,2})[\s,]+(\d{4}|\d{2})$/);
  if (m) {
    const mon = MONTH_NAMES[m[1].toLowerCase()];
    if (mon) return ymdToIso(m[3].length === 4 ? +m[3] : yearFromShort(m[3]), mon, +m[2]);
  }

  return null;
}

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

/** A regex rule on the field definition (text-like types only). The pattern itself is admin-chosen,
 *  not tenant-user-chosen, but it still runs through a bounded engine (lib/rules-engine/functions.ts's
 *  safeRegexFullMatch would be the natural fit if this ever needs the same hard timeout — not
 *  wired to it yet since field patterns are short, admin-authored strings, not formulas). */
function checkPattern(attr: AttributeDef, text: string): string | null {
  const pattern = attr.config.pattern;
  if (!pattern) return null;
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${pattern})$`);
  } catch {
    return null; // a bad pattern shouldn't block every save; the admin screen validates it at save time
  }
  return re.test(text) ? null : (attr.config.patternMessage?.trim() || "doesn't match the required pattern.");
}

function scalar(attr: AttributeDef, raw: unknown): Normalized {
  switch (attr.type) {
    case "text":
    case "long_text": {
      if (typeof raw !== "string") return fail(attr, "must be text.");
      const text = raw.trim();
      const hardMax = attr.type === "text" ? TEXT_MAX : LONG_TEXT_MAX;
      const max = typeof attr.config.maxLength === "number" && attr.config.maxLength > 0 ? Math.min(attr.config.maxLength, hardMax) : hardMax;
      if (text.length > max) return fail(attr, `is longer than ${max} characters.`);
      const minLength = attr.config.minLength;
      if (typeof minLength === "number" && minLength > 0 && text.length < minLength) return fail(attr, `must be at least ${minLength} characters.`);
      const patternError = checkPattern(attr, text);
      if (patternError) return fail(attr, patternError);
      return { ok: true, value: text };
    }
    case "number":
    case "currency": {
      const n = typeof raw === "string" ? Number(raw.trim().replace(/,/g, "")) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return fail(attr, "must be a number.");
      if (Math.abs(n) > 1e15) return fail(attr, "is too large.");
      if (typeof attr.config.min === "number" && n < attr.config.min) return fail(attr, `must be at least ${attr.config.min}.`);
      if (typeof attr.config.max === "number" && n > attr.config.max) return fail(attr, `must be at most ${attr.config.max}.`);
      return { ok: true, value: n };
    }
    case "checkbox": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true") return { ok: true, value: true };
      if (raw === "false") return { ok: true, value: false };
      return fail(attr, "must be true or false.");
    }
    case "date": {
      if (typeof raw !== "string") return fail(attr, "must be a date.");
      const iso = parseFlexibleDate(raw);
      if (!iso) return fail(attr, `"${raw.trim().slice(0, 40)}" is not a recognisable date.`);
      // ISO date strings sort the same as the calendar, so a plain string comparison is a date comparison.
      const min = typeof attr.config.min === "string" ? parseFlexibleDate(attr.config.min) : null;
      if (min && iso < min) return fail(attr, `must be on or after ${min}.`);
      const max = typeof attr.config.max === "string" ? parseFlexibleDate(attr.config.max) : null;
      if (max && iso > max) return fail(attr, `must be on or before ${max}.`);
      return { ok: true, value: iso };
    }
    case "timestamp": {
      if (typeof raw !== "string" && typeof raw !== "number") return fail(attr, "must be a date and time.");
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return fail(attr, "is not a valid date and time.");
      return { ok: true, value: d.toISOString() };
    }
    case "rating": {
      const max = typeof attr.config.max === "number" && attr.config.max > 0 ? attr.config.max : 5;
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
      const patternError = checkPattern(attr, email);
      if (patternError) return fail(attr, patternError);
      return { ok: true, value: email };
    }
    case "phone": {
      if (typeof raw !== "string") return fail(attr, "must be a phone number.");
      const phone = raw.trim().replace(/[\s().-]/g, "");
      if (!/^\+?\d{6,15}$/.test(phone)) return fail(attr, `"${raw.trim().slice(0, 30)}" is not a phone number.`);
      const patternError = checkPattern(attr, phone);
      if (patternError) return fail(attr, patternError);
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
      const patternError = checkPattern(attr, url.toString());
      if (patternError) return fail(attr, patternError);
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
      const patternError = checkPattern(attr, domain);
      if (patternError) return fail(attr, patternError);
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

import { runInNewContext } from "node:vm";
import type { EvalContext } from "./context";
import { FormulaError, type FormulaType, type Position, type Typed } from "./types";

/**
 * The non-short-circuiting function library: given already-evaluated arguments, compute a result.
 * Logic (AND/OR/NOT), IF, CASE, ISNEW, ISCHANGED and PRIORVALUE are NOT here — they need to see
 * unevaluated argument expressions (to short-circuit, or to read a field's identity rather than its
 * value) and are handled directly in evaluate.ts.
 *
 * Every entry is checked twice: `check` at parse/save time against static argument *types* (so a
 * wrong-shaped call is rejected before anything is ever evaluated), and `call` at evaluation time
 * against the actual argument *values*. Neither one touches a database or runs tenant-supplied code.
 */

export type FunctionDef = {
  minArgs: number;
  maxArgs: number | null;
  /** Validates argument types and returns this call's result type; throws FormulaError on a bad shape. */
  check: (argTypes: FormulaType[], pos: Position) => FormulaType;
  call: (args: Typed[], ctx: EvalContext, pos: Position) => Typed;
};

// ---------------------------------------------------------------------------
// Static (parse-time) type checking helpers
// ---------------------------------------------------------------------------

const DATE_LIKE: FormulaType[] = ["date", "datetime"];

/** `null` and `any` can't be ruled out statically (a blank literal, or a cross-record field whose
 *  type the schema didn't pin down) — only a clear mismatch between two concrete types is rejected. */
function expectType(argTypes: FormulaType[], index: number, allowed: FormulaType[], name: string, pos: Position): void {
  const t = argTypes[index];
  if (t === "null" || t === "any") return;
  if (!allowed.includes(t)) {
    throw new FormulaError(`${name}'s argument ${index + 1} must be ${allowed.join(" or a ")}, not ${t}.`, pos);
  }
}

function checkAll(argTypes: FormulaType[], allowed: FormulaType[], name: string, pos: Position): void {
  for (let i = 0; i < argTypes.length; i++) expectType(argTypes, i, allowed, name, pos);
}

function sameOrNullType(a: FormulaType, b: FormulaType): FormulaType {
  if (a === "null" || a === "any") return b;
  if (b === "null" || b === "any") return a;
  if (a === b) return a;
  return "any";
}

function assertArity(name: string, args: unknown[], min: number, max: number | null, pos: Position): void {
  if (args.length < min || (max !== null && args.length > max)) {
    const want = max === null ? `at least ${min}` : min === max ? `exactly ${min}` : `${min} to ${max}`;
    throw new FormulaError(`${name} takes ${want} argument${min === 1 && max === 1 ? "" : "s"}.`, pos);
  }
}

// ---------------------------------------------------------------------------
// Runtime value extraction — these only ever see values already approved by `check`, so a throw
// here means check and call disagreed, which the function's own tests catch.
// ---------------------------------------------------------------------------

export const num = (t: Typed, pos: Position): number => {
  if (typeof t.value !== "number") throw new FormulaError("Expected a number here.", pos);
  return t.value;
};
export const text = (t: Typed, pos: Position): string => {
  if (t.value === null) return "";
  if (typeof t.value !== "string") throw new FormulaError("Expected text here.", pos);
  return t.value;
};
export const date = (t: Typed, pos: Position): Date => {
  if (!(t.value instanceof Date)) throw new FormulaError("Expected a date here.", pos);
  return t.value;
};
export const list = (t: Typed, pos: Position): string[] => {
  if (!Array.isArray(t.value)) throw new FormulaError("Expected a multi-value field here.", pos);
  return t.value;
};
export const isBlank = (t: Typed): boolean => t.value === null || (typeof t.value === "string" && t.value.trim() === "");
/** TRUE only for the literal true — Salesforce formula booleans are never blank, but a bad or
 *  absent value should read as "no" rather than throw mid-evaluation. */
export const asBoolean = (t: Typed): boolean => t.value === true;

/** A field the platform stores as `currency` is rounded to this precision before it is compared, so
 *  float arithmetic (19999.999999999996) doesn't read as "not quite 20000". The platform itself
 *  stores money as a plain number (lib/data-model/values.ts); this is the practical limit of safety
 *  without changing that storage to a fixed-point type. Exposed for the = / < / > operators. */
export function money(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Dates: calendar fields are read in the tenant's time zone for "datetime" values (a real instant),
// and in UTC for "date" values (already a timezone-less calendar day stored at UTC midnight).
// ---------------------------------------------------------------------------

const WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function partsInZone(d: Date, tz: string): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric", weekday: "short" }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: WEEKDAY_ABBR.indexOf(get("weekday")) + 1 };
}

function dateParts(t: Typed, ctx: EvalContext, pos: Position): { year: number; month: number; day: number; weekday: number } {
  const d = date(t, pos);
  if (t.type === "date") return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: (d.getUTCDay() % 7) + 1 };
  return partsInZone(d, ctx.timeZone);
}

function utcMidnight(year: number, month: number, day: number, pos: Position): Date {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new FormulaError("That isn't a real calendar date.", pos);
  }
  return d;
}

/** Today's calendar date in `tz`, as a UTC-midnight Date (the engine's "date" representation). */
export function todayInZone(now: Date, tz: string): Date {
  const { year, month, day } = partsInZone(now, tz);
  return new Date(Date.UTC(year, month - 1, day));
}

// ---------------------------------------------------------------------------
// REGEX: a hard wall-clock timeout via node:vm, so a catastrophic-backtracking pattern can't hang a
// save. The vm here runs a fixed, trusted script (never tenant-supplied code) against two
// tenant-supplied strings — it is a CPU timeout, not a sandbox for untrusted code.
// ---------------------------------------------------------------------------

const REGEX_TIMEOUT_MS = 50;
const REGEX_MAX_PATTERN = 200;
const REGEX_MAX_TEXT = 5000;

function safeRegexFullMatch(pattern: string, value: string): boolean {
  if (pattern.length > REGEX_MAX_PATTERN) return false;
  const input = value.length > REGEX_MAX_TEXT ? value.slice(0, REGEX_MAX_TEXT) : value;
  try {
    return !!runInNewContext("new RegExp('^(?:' + pattern + ')$').test(input)", { pattern, input }, { timeout: REGEX_TIMEOUT_MS });
  } catch {
    // Bad pattern syntax, or it ran past the timeout (what would have been a hang): neither blocks
    // the save outright — REGEX() just reads as "didn't match".
    return false;
  }
}

export const FUNCTIONS: Record<string, FunctionDef> = {
  // ---- Logic helpers that don't need short-circuiting ----
  ISBLANK: {
    minArgs: 1,
    maxArgs: 1,
    check: () => "boolean",
    call: ([a]) => ({ value: isBlank(a), type: "boolean" }),
  },
  BLANKVALUE: {
    minArgs: 2,
    maxArgs: 2,
    check: (t) => sameOrNullType(t[0], t[1]),
    call: ([a, b]) => (isBlank(a) ? b : a),
  },
  NULLVALUE: {
    minArgs: 2,
    maxArgs: 2,
    check: (t) => sameOrNullType(t[0], t[1]),
    call: ([a, b]) => (isBlank(a) ? b : a),
  },

  // ---- Math ----
  ABS: {
    minArgs: 1,
    maxArgs: 1,
    check: (t, pos) => (checkAll(t, ["number"], "ABS", pos), "number"),
    call: ([a], _c, pos) => ({ value: Math.abs(num(a, pos)), type: "number" }),
  },
  ROUND: {
    minArgs: 1,
    maxArgs: 2,
    check: (t, pos) => (checkAll(t, ["number"], "ROUND", pos), "number"),
    call: (args, _c, pos) => {
      const n = num(args[0], pos);
      const places = args.length > 1 ? num(args[1], pos) : 0;
      const f = 10 ** places;
      return { value: Math.round(n * f) / f, type: "number" };
    },
  },
  MIN: {
    minArgs: 1,
    maxArgs: null,
    check: (t, pos) => (checkAll(t, ["number"], "MIN", pos), "number"),
    call: (args, _c, pos) => ({ value: Math.min(...args.map((a) => num(a, pos))), type: "number" }),
  },
  MAX: {
    minArgs: 1,
    maxArgs: null,
    check: (t, pos) => (checkAll(t, ["number"], "MAX", pos), "number"),
    call: (args, _c, pos) => ({ value: Math.max(...args.map((a) => num(a, pos))), type: "number" }),
  },
  MOD: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (checkAll(t, ["number"], "MOD", pos), "number"),
    call: ([a, b], _c, pos) => ({ value: num(a, pos) % num(b, pos), type: "number" }),
  },

  // ---- Text ----
  LEN: {
    minArgs: 1,
    maxArgs: 1,
    check: (t, pos) => (expectType(t, 0, ["text"], "LEN", pos), "number"),
    call: ([a], _c, pos) => ({ value: text(a, pos).length, type: "number" }),
  },
  LEFT: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (expectType(t, 0, ["text"], "LEFT", pos), expectType(t, 1, ["number"], "LEFT", pos), "text"),
    call: ([a, n], _c, pos) => ({ value: text(a, pos).slice(0, Math.max(0, num(n, pos))), type: "text" }),
  },
  RIGHT: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (expectType(t, 0, ["text"], "RIGHT", pos), expectType(t, 1, ["number"], "RIGHT", pos), "text"),
    call: ([a, n], _c, pos) => {
      const s = text(a, pos);
      const len = Math.max(0, num(n, pos));
      return { value: len === 0 ? "" : s.slice(-len), type: "text" };
    },
  },
  MID: {
    minArgs: 3,
    maxArgs: 3,
    check: (t, pos) => (expectType(t, 0, ["text"], "MID", pos), expectType(t, 1, ["number"], "MID", pos), expectType(t, 2, ["number"], "MID", pos), "text"),
    call: ([a, start, len], _c, pos) => {
      const s = text(a, pos);
      const from = Math.max(1, Math.trunc(num(start, pos))) - 1; // Salesforce MID is 1-indexed
      return { value: s.slice(from, from + Math.max(0, Math.trunc(num(len, pos)))), type: "text" };
    },
  },
  TRIM: { minArgs: 1, maxArgs: 1, check: (t, pos) => (expectType(t, 0, ["text"], "TRIM", pos), "text"), call: ([a], _c, pos) => ({ value: text(a, pos).trim(), type: "text" }) },
  UPPER: { minArgs: 1, maxArgs: 1, check: (t, pos) => (expectType(t, 0, ["text"], "UPPER", pos), "text"), call: ([a], _c, pos) => ({ value: text(a, pos).toUpperCase(), type: "text" }) },
  LOWER: { minArgs: 1, maxArgs: 1, check: (t, pos) => (expectType(t, 0, ["text"], "LOWER", pos), "text"), call: ([a], _c, pos) => ({ value: text(a, pos).toLowerCase(), type: "text" }) },
  CONTAINS: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (checkAll(t, ["text"], "CONTAINS", pos), "boolean"),
    call: ([a, b], _c, pos) => ({ value: text(a, pos).includes(text(b, pos)), type: "boolean" }),
  },
  BEGINS: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (checkAll(t, ["text"], "BEGINS", pos), "boolean"),
    call: ([a, b], _c, pos) => ({ value: text(a, pos).startsWith(text(b, pos)), type: "boolean" }),
  },
  ENDS: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (checkAll(t, ["text"], "ENDS", pos), "boolean"),
    call: ([a, b], _c, pos) => ({ value: text(a, pos).endsWith(text(b, pos)), type: "boolean" }),
  },
  REGEX: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (checkAll(t, ["text"], "REGEX", pos), "boolean"),
    call: ([a, b], _c, pos) => ({ value: safeRegexFullMatch(text(b, pos), text(a, pos)), type: "boolean" }),
  },
  TEXT: {
    minArgs: 1,
    maxArgs: 1,
    check: () => "text",
    call: ([a], _c, pos) => {
      if (a.value === null) return { value: "", type: "text" };
      if (a.type === "boolean") return { value: a.value ? "true" : "false", type: "text" };
      if (a.type === "number") return { value: String(a.value), type: "text" };
      if (a.type === "date") return { value: date(a, pos).toISOString().slice(0, 10), type: "text" };
      if (a.type === "datetime") return { value: date(a, pos).toISOString(), type: "text" };
      if (a.type === "list") return { value: list(a, pos).join(", "), type: "text" };
      return { value: text(a, pos), type: "text" };
    },
  },
  VALUE: {
    minArgs: 1,
    maxArgs: 1,
    check: (t, pos) => (expectType(t, 0, ["text"], "VALUE", pos), "number"),
    call: ([a], _c, pos) => {
      const s = text(a, pos).trim().replace(/,/g, "");
      const n = Number(s);
      if (s === "" || !Number.isFinite(n)) throw new FormulaError(`"${text(a, pos).slice(0, 40)}" isn't a number.`, pos);
      return { value: n, type: "number" };
    },
  },

  // ---- Date and time ----
  TODAY: { minArgs: 0, maxArgs: 0, check: () => "date", call: (_a, ctx) => ({ value: todayInZone(ctx.now, ctx.timeZone), type: "date" }) },
  NOW: { minArgs: 0, maxArgs: 0, check: () => "datetime", call: (_a, ctx) => ({ value: ctx.now, type: "datetime" }) },
  DATE: {
    minArgs: 3,
    maxArgs: 3,
    check: (t, pos) => (checkAll(t, ["number"], "DATE", pos), "date"),
    call: ([y, m, d], _c, pos) => ({ value: utcMidnight(Math.trunc(num(y, pos)), Math.trunc(num(m, pos)), Math.trunc(num(d, pos)), pos), type: "date" }),
  },
  ADDDAYS: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (expectType(t, 0, DATE_LIKE, "ADDDAYS", pos), expectType(t, 1, ["number"], "ADDDAYS", pos), t[0] === "datetime" ? "datetime" : "date"),
    call: ([a, n], _c, pos) => ({ value: new Date(date(a, pos).getTime() + Math.trunc(num(n, pos)) * 86_400_000), type: a.type as "date" | "datetime" }),
  },
  ADDMONTHS: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (expectType(t, 0, DATE_LIKE, "ADDMONTHS", pos), expectType(t, 1, ["number"], "ADDMONTHS", pos), t[0] === "datetime" ? "datetime" : "date"),
    call: ([a, n], _c, pos) => {
      const d = date(a, pos);
      const next = new Date(d.getTime());
      next.setUTCMonth(next.getUTCMonth() + Math.trunc(num(n, pos)));
      return { value: next, type: a.type as "date" | "datetime" };
    },
  },
  DAYS_BETWEEN: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (checkAll(t, DATE_LIKE, "DAYS_BETWEEN", pos), "number"),
    call: ([a, b], _c, pos) => ({ value: (date(b, pos).getTime() - date(a, pos).getTime()) / 86_400_000, type: "number" }),
  },
  YEAR: { minArgs: 1, maxArgs: 1, check: (t, pos) => (expectType(t, 0, DATE_LIKE, "YEAR", pos), "number"), call: ([a], ctx, pos) => ({ value: dateParts(a, ctx, pos).year, type: "number" }) },
  MONTH: { minArgs: 1, maxArgs: 1, check: (t, pos) => (expectType(t, 0, DATE_LIKE, "MONTH", pos), "number"), call: ([a], ctx, pos) => ({ value: dateParts(a, ctx, pos).month, type: "number" }) },
  DAY: { minArgs: 1, maxArgs: 1, check: (t, pos) => (expectType(t, 0, DATE_LIKE, "DAY", pos), "number"), call: ([a], ctx, pos) => ({ value: dateParts(a, ctx, pos).day, type: "number" }) },
  /** 1 = Sunday .. 7 = Saturday, matching Salesforce. */
  WEEKDAY: { minArgs: 1, maxArgs: 1, check: (t, pos) => (expectType(t, 0, DATE_LIKE, "WEEKDAY", pos), "number"), call: ([a], ctx, pos) => ({ value: dateParts(a, ctx, pos).weekday, type: "number" }) },

  // ---- Comparisons that don't fit the binary operators ----
  BETWEEN: {
    minArgs: 3,
    maxArgs: 3,
    check: (t, pos) => {
      if (t[0] !== "null" && t[0] !== "any" && t[0] !== "number" && !DATE_LIKE.includes(t[0])) {
        throw new FormulaError("BETWEEN needs numbers or dates.", pos);
      }
      const kind: FormulaType[] = t[0] === "number" ? ["number"] : DATE_LIKE;
      expectType(t, 1, kind, "BETWEEN", pos);
      expectType(t, 2, kind, "BETWEEN", pos);
      return "boolean";
    },
    call: ([v, lo, hi], _c, pos) => {
      if (v.type === "number") return { value: num(v, pos) >= num(lo, pos) && num(v, pos) <= num(hi, pos), type: "boolean" };
      const t = date(v, pos).getTime();
      return { value: t >= date(lo, pos).getTime() && t <= date(hi, pos).getTime(), type: "boolean" };
    },
  },

  // ---- Select fields ----
  ISPICKVAL: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (expectType(t, 0, ["text"], "ISPICKVAL", pos), expectType(t, 1, ["text"], "ISPICKVAL", pos), "boolean"),
    call: ([a, b], _c, pos) => ({ value: !isBlank(a) && text(a, pos).trim().toLowerCase() === text(b, pos).trim().toLowerCase(), type: "boolean" }),
  },
  INCLUDES: {
    minArgs: 2,
    maxArgs: 2,
    check: (t, pos) => (expectType(t, 0, ["list"], "INCLUDES", pos), expectType(t, 1, ["text"], "INCLUDES", pos), "boolean"),
    call: ([a, b], _c, pos) => {
      const want = text(b, pos).trim().toLowerCase();
      return { value: list(a, pos).some((v) => v.trim().toLowerCase() === want), type: "boolean" };
    },
  },
};

/** A plain object indexed by tenant-chosen text resolves "constructor", "toString", "__proto__"
 *  etc. through the prototype chain instead of failing — `Object.hasOwn` is the only safe lookup. */
function lookupFunction(name: string): FunctionDef | undefined {
  return Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
}

export function callFunction(name: string, args: Typed[], ctx: EvalContext, pos: Position): Typed {
  const def = lookupFunction(name);
  if (!def) throw new FormulaError(`Unknown function ${name}().`, pos);
  assertArity(name, args, def.minArgs, def.maxArgs, pos);
  return def.call(args, ctx, pos);
}

export function checkFunction(name: string, argTypes: FormulaType[], pos: Position): FormulaType {
  const def = lookupFunction(name);
  if (!def) throw new FormulaError(`Unknown function ${name}().`, pos);
  assertArity(name, argTypes, def.minArgs, def.maxArgs, pos);
  return def.check(argTypes, pos);
}

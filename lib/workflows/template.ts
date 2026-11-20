/**
 * Variables in block inputs: "{{trigger.record.name}}", "{{b3.record.id}}". Pure, and deliberately
 * not a scripting language: a variable is a dotted path into the run's data, nothing more, so a
 * block can never run code.
 */

const WHOLE = /^\s*\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}\s*$/;
const ANY = /\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}/g;
const MAX_LENGTH = 20_000;

/** Read a dotted path ("trigger.record.values.email_addresses.0") out of the run's data. */
export function getPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    // Never reach into the prototype chain.
    if (part === "__proto__" || part === "constructor" || part === "prototype") return undefined;
    if (Array.isArray(cur)) {
      const i = Number(part);
      cur = Number.isInteger(i) ? cur[i] : undefined;
    } else if (typeof cur === "object") {
      cur = Object.prototype.hasOwnProperty.call(cur, part) ? (cur as Record<string, unknown>)[part] : undefined;
    } else return undefined;
  }
  return cur;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(show).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * Resolve one input. A value that is exactly one variable keeps its type (a number stays a number,
 * a list stays a list); text with variables inside becomes a string; anything else passes through.
 * `fallback` is used when the variable is empty.
 */
export function resolveValue(input: unknown, data: unknown, fallback?: unknown): unknown {
  if (typeof input !== "string") return input;
  if (input.length > MAX_LENGTH) return input;
  const whole = input.match(WHOLE);
  if (whole) {
    const v = getPath(data, whole[1]);
    return v === undefined || v === null || v === "" ? (fallback ?? v) : v;
  }
  return input.replace(ANY, (_m, path: string) => {
    const v = getPath(data, path);
    return show(v === undefined || v === null || v === "" ? fallback : v);
  });
}

/** Variable paths mentioned in a string, so the editor can warn about one that points nowhere. */
export function variablesIn(input: string): string[] {
  return [...input.matchAll(ANY)].map((m) => m[1]);
}

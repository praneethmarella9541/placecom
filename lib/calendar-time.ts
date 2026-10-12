/**
 * Time-zone helpers for calendar events (client- and server-safe).
 *
 * A calendar form holds a *wall-clock* time ("2026-10-20T10:00") and a time zone. Sending
 * Google that wall time plus the zone (`dateTime` without an offset + `timeZone`) is exact,
 * DST included — what must NOT be done is `new Date(wallTime)`, which reads it in the
 * browser's own zone and is wrong as soon as the event is in another one.
 */

const COMMON_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
];

/** The browser's own zone. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}

/** Every IANA zone the browser knows (a short common list on older browsers), with `include` guaranteed present. */
export function listTimeZones(include?: string[]): string[] {
  let all: string[] = [];
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (f) all = f("timeZone");
  } catch {
    /* fall back below */
  }
  // Always include the common zones by the names people expect: some browsers list India as
  // the legacy "Asia/Calcutta" (and not "Asia/Kolkata"), which would leave it out of the picker.
  const set = new Set([...all, ...COMMON_ZONES]);
  if (set.has("Asia/Kolkata")) set.delete("Asia/Calcutta");
  for (const z of include ?? []) if (z) set.add(z);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/** "GMT+5:30" style label for a zone right now. */
export function zoneOffsetLabel(tz: string, atMs: number = Date.now()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date(atMs));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
  } catch {
    return tz;
  }
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number };

function parseWall(wall: string): Wall | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(wall.trim());
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] ?? 0), mi: +(m[5] ?? 0), s: +(m[6] ?? 0) };
}

/** Offset (ms) of `tz` from UTC at the instant `utcMs`: wall-clock-in-tz minus UTC. */
function offsetAt(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => +(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant (ms) at which the wall time "YYYY-MM-DDTHH:mm" occurs in `tz`. NaN if the text isn't a date. */
export function wallToUtcMs(wall: string, tz: string): number {
  const w = parseWall(wall);
  if (!w) return NaN;
  const naive = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  // Two passes settle the offset across a DST change.
  let guess = naive - offsetAt(naive, tz);
  guess = naive - offsetAt(guess, tz);
  return guess;
}

/** The wall time "YYYY-MM-DDTHH:mm" in `tz` at a UTC instant. */
export function utcMsToWall(utcMs: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

/** Wall time with seconds, for Google's `dateTime` field: "2026-10-20T10:00:00". */
export function wallForGoogle(wall: string): string {
  const w = parseWall(wall);
  if (!w) return wall;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${w.y}-${p(w.mo)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}:${p(w.s)}`;
}

/** Add whole days to "YYYY-MM-DD". */
export function addDaysToDate(date: string, days: number): string {
  const w = parseWall(date);
  if (!w) return date;
  const d = new Date(Date.UTC(w.y, w.mo - 1, w.d + days));
  return d.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" part of a wall time. */
export function datePart(wall: string): string {
  return wall.slice(0, 10);
}

/** Google's UNTIL for a timed event repeating through the END of `date` in `tz`: "YYYYMMDDTHHMMSSZ". */
export function untilUtcForDate(date: string, tz: string): string {
  const ms = wallToUtcMs(`${date}T23:59:59`, tz);
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** "YYYYMMDD" for an all-day event's UNTIL. */
export function untilDateValue(date: string): string {
  return date.replace(/-/g, "");
}

/** UTC "YYYYMMDDTHHMMSSZ" for an instant (the form Google wants for a timed UNTIL). */
export function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

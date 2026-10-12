import { untilDateValue, untilUtcForDate, utcMsToWall } from "@/lib/calendar-time";

/**
 * Repeat rules for calendar events: the quick presets, a custom editor (every N days/weeks/
 * months/years, chosen weekdays, ends never / on a date / after N times), parsing Google's RRULEs
 * back into those, and the small RRULE edits needed to split a series ("this and following").
 */

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type RecurrenceEnd = { type: "never" } | { type: "until"; date: string } | { type: "count"; count: number };
export type RecurrenceSpec = { freq: Freq; interval: number; byDay: Weekday[]; end: RecurrenceEnd };

/**
 * UI presets. "custom" opens the editor. "keep" is only ever produced when reading an existing
 * event whose rule the editor can't represent (e.g. "2nd Tuesday"): it is left exactly as it is.
 */
export type RecurrencePreset = "none" | "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "custom" | "keep";

export const RECURRENCE_OPTIONS: { value: RecurrencePreset; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Every weekday (Mon–Fri)" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom…" },
];

export const DEFAULT_CUSTOM_SPEC: RecurrenceSpec = { freq: "WEEKLY", interval: 1, byDay: [], end: { type: "never" } };

export function specForPreset(preset: RecurrencePreset): RecurrenceSpec | null {
  const never: RecurrenceEnd = { type: "never" };
  switch (preset) {
    case "daily":
      return { freq: "DAILY", interval: 1, byDay: [], end: never };
    case "weekdays":
      return { freq: "WEEKLY", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"], end: never };
    case "weekly":
      return { freq: "WEEKLY", interval: 1, byDay: [], end: never };
    case "biweekly":
      return { freq: "WEEKLY", interval: 2, byDay: [], end: never };
    case "monthly":
      return { freq: "MONTHLY", interval: 1, byDay: [], end: never };
    default:
      return null;
  }
}

export type RecurrenceContext = { allDay: boolean; timeZone: string };

/** One RRULE line for a spec. For a timed event UNTIL is the end of that day in its zone, in UTC; for all-day it is the date. */
export function rruleFromSpec(spec: RecurrenceSpec, ctx: RecurrenceContext): string {
  const parts = [`FREQ=${spec.freq}`];
  if (spec.interval > 1) parts.push(`INTERVAL=${spec.interval}`);
  if (spec.freq === "WEEKLY" && spec.byDay.length > 0) {
    parts.push(`BYDAY=${WEEKDAYS.filter((d) => spec.byDay.includes(d)).join(",")}`);
  }
  if (spec.end.type === "count") parts.push(`COUNT=${spec.end.count}`);
  if (spec.end.type === "until") {
    parts.push(`UNTIL=${ctx.allDay ? untilDateValue(spec.end.date) : untilUtcForDate(spec.end.date, ctx.timeZone)}`);
  }
  return `RRULE:${parts.join(";")}`;
}

/**
 * The `recurrence` array for the chosen preset: undefined for "does not repeat" and for "keep"
 * (an existing rule we leave alone). For a custom rule, `custom` is used.
 */
export function buildRecurrence(
  preset: RecurrencePreset,
  custom: RecurrenceSpec,
  ctx: RecurrenceContext
): string[] | undefined {
  if (preset === "none" || preset === "keep") return undefined;
  const spec = preset === "custom" ? custom : specForPreset(preset);
  return spec ? [rruleFromSpec(spec, ctx)] : undefined;
}

/** Backwards-compatible: the plain presets, forever. */
export function buildRecurrenceRules(preset: RecurrencePreset): string[] | undefined {
  const spec = specForPreset(preset);
  return spec ? [rruleFromSpec(spec, { allDay: false, timeZone: "UTC" })] : undefined;
}

/** Why a custom rule can't be used, or null if it can. `startDate` is the first day, "YYYY-MM-DD". */
export function validateSpec(spec: RecurrenceSpec, startDate: string): string | null {
  if (!Number.isInteger(spec.interval) || spec.interval < 1 || spec.interval > 99) return "Repeat every must be between 1 and 99.";
  if (spec.freq === "WEEKLY" && spec.byDay.length === 0) return "Pick at least one weekday.";
  if (spec.end.type === "count" && (!Number.isInteger(spec.end.count) || spec.end.count < 1 || spec.end.count > 999)) {
    return "Number of times must be between 1 and 999.";
  }
  if (spec.end.type === "until") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.end.date)) return "Choose the date the repeat ends.";
    if (startDate && spec.end.date < startDate) return "The repeat can't end before the event starts.";
  }
  return null;
}

/** Reads a stored UNTIL (date or UTC instant) as a "YYYY-MM-DD" in the event's zone. */
function untilToDate(value: string, timeZone: string): string | null {
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (d) return `${d[1]}-${d[2]}-${d[3]}`;
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  if (!t) return null;
  const ms = Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +t[6]);
  return utcMsToWall(ms, timeZone).slice(0, 10);
}

/**
 * Reads the first RRULE of an event into a preset + spec. Anything the editor can't express
 * (positional days like "2nd Tuesday", BYMONTHDAY, BYSETPOS …) comes back as "keep", so editing
 * such an event never silently rewrites its repeat.
 */
export function parseRecurrence(
  recurrence: string[] | undefined | null,
  timeZone: string = "UTC"
): { preset: RecurrencePreset; spec: RecurrenceSpec | null } {
  const line = (recurrence ?? []).find((r) => /^RRULE:/i.test(r));
  if (!line) return { preset: "none", spec: null };
  const kv = new Map<string, string>();
  for (const part of line.replace(/^RRULE:/i, "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) kv.set(part.slice(0, i).toUpperCase(), part.slice(i + 1));
  }
  const unsupported = Array.from(kv.keys()).some((k) => !["FREQ", "INTERVAL", "BYDAY", "COUNT", "UNTIL", "WKST"].includes(k));
  const freq = kv.get("FREQ") as Freq | undefined;
  if (unsupported || !freq || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return { preset: "keep", spec: null };

  const byDayRaw = kv.get("BYDAY");
  const byDay: Weekday[] = [];
  if (byDayRaw) {
    for (const d of byDayRaw.split(",")) {
      if (!(WEEKDAYS as readonly string[]).includes(d)) return { preset: "keep", spec: null }; // e.g. "2TU"
      byDay.push(d as Weekday);
    }
    if (freq !== "WEEKLY") return { preset: "keep", spec: null };
  }
  const interval = kv.has("INTERVAL") ? parseInt(kv.get("INTERVAL")!, 10) : 1;
  if (!Number.isInteger(interval) || interval < 1) return { preset: "keep", spec: null };

  let end: RecurrenceEnd = { type: "never" };
  if (kv.has("COUNT")) {
    const count = parseInt(kv.get("COUNT")!, 10);
    if (!Number.isInteger(count) || count < 1) return { preset: "keep", spec: null };
    end = { type: "count", count };
  } else if (kv.has("UNTIL")) {
    const date = untilToDate(kv.get("UNTIL")!, timeZone);
    if (!date) return { preset: "keep", spec: null };
    end = { type: "until", date };
  }

  const spec: RecurrenceSpec = { freq, interval, byDay, end };
  if (end.type === "never") {
    for (const p of ["daily", "weekdays", "weekly", "biweekly", "monthly"] as RecurrencePreset[]) {
      const ps = specForPreset(p)!;
      if (ps.freq === spec.freq && ps.interval === spec.interval && ps.byDay.join() === spec.byDay.join()) return { preset: p, spec };
    }
  }
  return { preset: "custom", spec };
}

/** Back-compat: just the preset. */
export function parseRecurrencePreset(recurrence?: string[] | null): RecurrencePreset {
  return parseRecurrence(recurrence).preset;
}

const LONG_DAY: Record<Weekday, string> = {
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
  SU: "Sunday",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1] ?? ""} ${d}, ${y}`;
}

/**
 * How Google Calendar words a repeat: "Daily", "Weekly on Monday", "Every weekday",
 * "Every 2 weeks on Mon, Wed", "Monthly on day 12", "Annually on October 12" — then the end
 * (", until December 31, 2026" / ", 6 times"). `startDate` ("YYYY-MM-DD") fills in the day
 * when the rule itself doesn't name one. Null if the event doesn't repeat.
 */
export function formatRecurrenceLabel(
  recurrence?: string[] | null,
  timeZone: string = "UTC",
  startDate?: string
): string | null {
  const { preset, spec } = parseRecurrence(recurrence, timeZone);
  if (preset === "none") return null;
  if (!spec) return "Repeats (custom)";
  const n = spec.interval;
  const sd = startDate && /^\d{4}-\d{2}-\d{2}/.test(startDate) ? startDate.slice(0, 10) : "";
  const startDay = sd ? WEEKDAYS[(new Date(`${sd}T12:00:00Z`).getUTCDay() + 6) % 7] : undefined;
  const days = WEEKDAYS.filter((d) => spec.byDay.includes(d));
  let text: string;
  if (spec.freq === "DAILY") {
    text = n === 1 ? "Daily" : `Every ${n} days`;
  } else if (spec.freq === "WEEKLY") {
    const isWeekdays = days.length === 5 && days.join() === "MO,TU,WE,TH,FR";
    if (isWeekdays && n === 1) text = "Every weekday";
    else {
      const on = days.length ? days : startDay ? [startDay] : [];
      const names = on.length === 1 ? LONG_DAY[on[0]] : on.map((d) => WEEKDAY_LABELS[d]).join(", ");
      text = (n === 1 ? "Weekly" : `Every ${n} weeks`) + (on.length ? ` on ${names}` : "");
    }
  } else if (spec.freq === "MONTHLY") {
    text = (n === 1 ? "Monthly" : `Every ${n} months`) + (sd ? ` on day ${Number(sd.slice(8, 10))}` : "");
  } else {
    text = (n === 1 ? "Annually" : `Every ${n} years`) + (sd ? ` on ${MONTHS[Number(sd.slice(5, 7)) - 1]} ${Number(sd.slice(8, 10))}` : "");
  }
  if (spec.end.type === "until") text += `, until ${longDate(spec.end.date)}`;
  if (spec.end.type === "count") text += `, ${spec.end.count} time${spec.end.count === 1 ? "" : "s"}`;
  return text;
}

/* ── RRULE edits for series operations ─────────────────────────────────── */

/** The first RRULE line of a recurrence array, or undefined. */
export function firstRrule(recurrence: string[] | undefined | null): string | undefined {
  return (recurrence ?? []).find((r) => /^RRULE:/i.test(r));
}

function setParts(rrule: string, edit: (kv: Map<string, string>) => void): string {
  const kv = new Map<string, string>();
  for (const part of rrule.replace(/^RRULE:/i, "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) kv.set(part.slice(0, i).toUpperCase(), part.slice(i + 1));
  }
  edit(kv);
  return "RRULE:" + Array.from(kv, ([k, v]) => `${k}=${v}`).join(";");
}

/** The rule ending at `until` (a UTC stamp for timed events, "YYYYMMDD" for all-day); COUNT is dropped, as UNTIL and COUNT can't both be set. */
export function rruleWithUntil(rrule: string, until: string): string {
  return setParts(rrule, (kv) => {
    kv.delete("COUNT");
    kv.set("UNTIL", until);
  });
}

/** The rule limited to `count` occurrences; UNTIL is dropped. */
export function rruleWithCount(rrule: string, count: number): string {
  return setParts(rrule, (kv) => {
    kv.delete("UNTIL");
    kv.set("COUNT", String(count));
  });
}

export function rruleCount(rrule: string): number | null {
  const m = /(?:^|;)COUNT=(\d+)/i.exec(rrule);
  return m ? parseInt(m[1], 10) : null;
}

/** Replace the RRULE in a recurrence array, keeping EXDATE / RDATE lines. */
export function replaceRrule(existing: string[] | undefined | null, rules: string[] | undefined): string[] {
  const others = (existing ?? []).filter((r) => !/^RRULE:/i.test(r));
  return [...(rules ?? []), ...others];
}

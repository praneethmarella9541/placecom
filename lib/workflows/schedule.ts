/** When a schedule trigger next fires. Pure; tested in schedule.test.mts. */

export type ScheduleConfig = { every: "hour" | "day" | "week"; at?: string; weekday?: number; tz?: string };

/** Offset (ms) of a time zone from UTC at an instant: local wall time minus UTC. */
function tzOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which a wall-clock time happens in a zone (handles daylight saving by iterating once). */
export function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let utc = guess - tzOffsetMs(guess, tz);
  utc = guess - tzOffsetMs(utc, tz);
  return utc;
}

/** The wall-clock date parts in a zone for an instant. */
function localParts(instant: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(instant));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday };
}

/** The first fire time strictly after `after`. */
export function nextFireAt(config: ScheduleConfig, after: Date): Date {
  const tz = config.tz || "Asia/Kolkata";
  if (config.every === "hour") {
    return new Date((Math.floor(after.getTime() / 3_600_000) + 1) * 3_600_000);
  }
  const [h, mi] = (config.at ?? "09:00").split(":").map(Number);
  const start = localParts(after.getTime(), tz);
  for (let add = 0; add <= 8; add++) {
    // Walk forward one calendar day at a time in the zone.
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + add));
    const y = day.getUTCFullYear(), m = day.getUTCMonth() + 1, d = day.getUTCDate();
    const candidate = zonedTimeToUtc(y, m, d, h, mi, tz);
    if (candidate <= after.getTime()) continue;
    if (config.every === "week" && day.getUTCDay() !== (config.weekday ?? 1)) continue;
    return new Date(candidate);
  }
  return new Date(after.getTime() + 86_400_000);
}

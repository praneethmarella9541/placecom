/**
 * Sending-window and delay math for Sequences.
 *
 * Deliberately dependency-free (no date library is installed) and deliberately
 * NOT server-only: the cron uses it to schedule sends and the UI uses the same
 * code to render "Next send: Tue, 9:00 AM" — so the two can never disagree.
 */

export type SendWindow = {
  /** IANA zone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** Minutes from local midnight the window opens. */
  startMinutes: number;
  /** Minutes from local midnight the window closes. */
  endMinutes: number;
  businessDaysOnly: boolean;
};

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Guard rail so a malformed window can never spin the cron. */
const MAX_DAY_SCANS = 21;

export function isValidTimeZone(timezone: string): boolean {
  if (!timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** "09:00" or Postgres' "09:00:00" → minutes from midnight. */
export function parseTimeToMinutes(value: string): number {
  const [h, m] = value.split(":");
  const hours = Number(h);
  const minutes = Number(m ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return Math.max(0, Math.min(24 * 60 - 1, hours * 60 + minutes));
}

export function formatMinutesAsTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Offset of `timeZone` from UTC, in minutes, at `instant`. Positive east of UTC.
 * Falls back to 0 (UTC) rather than throwing — a bad zone on one row must not
 * take down a whole cron run.
 */
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const map: Record<string, number> = {};
    for (const part of dtf.formatToParts(instant)) {
      if (part.type !== "literal") map[part.type] = Number(part.value);
    }
    const asUtc = Date.UTC(
      map.year,
      (map.month ?? 1) - 1,
      map.day ?? 1,
      (map.hour ?? 0) % 24,
      map.minute ?? 0,
      map.second ?? 0,
    );
    return Math.round((asUtc - instant.getTime()) / MINUTE_MS);
  } catch {
    return 0;
  }
}

/** Wall-clock parts of `instant` as seen in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const shifted = new Date(instant.getTime() + tzOffsetMinutes(instant, timeZone) * MINUTE_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * The UTC instant at which `timeZone` shows the given wall-clock time.
 * Two-pass so a delay landing across a DST transition resolves correctly.
 */
export function zonedTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  const firstGuess = naive - tzOffsetMinutes(new Date(naive), timeZone) * MINUTE_MS;
  const corrected = naive - tzOffsetMinutes(new Date(firstGuess), timeZone) * MINUTE_MS;
  return new Date(corrected);
}

function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

/** Same calendar date advanced by `days`, ignoring time-of-day. */
function shiftCalendarDays(parts: ZonedParts, days: number): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) + days * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Advance by `days` business days (Mon-Fri), skipping weekends entirely. */
function shiftBusinessDays(parts: ZonedParts, days: number): { year: number; month: number; day: number } {
  let cursor = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  let added = 0;
  while (added < days) {
    cursor = new Date(cursor.getTime() + DAY_MS);
    if (!isWeekend(cursor.getUTCDay())) added += 1;
  }
  return { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
}

/**
 * The first instant at or after `from` that falls inside the sending window on
 * an allowed day. Returns `from` unchanged when it is already inside.
 */
export function nextSendSlot(from: Date, window: SendWindow): Date {
  const startHour = Math.floor(window.startMinutes / 60);
  const startMinute = window.startMinutes % 60;
  let cursor = from;

  for (let i = 0; i < MAX_DAY_SCANS; i += 1) {
    const parts = zonedParts(cursor, window.timezone);

    if (window.businessDaysOnly && isWeekend(parts.weekday)) {
      const next = shiftCalendarDays(parts, 1);
      cursor = zonedTimeToUtc({ ...next, hour: startHour, minute: startMinute }, window.timezone);
      continue;
    }

    const minutesOfDay = parts.hour * 60 + parts.minute;

    if (minutesOfDay < window.startMinutes) {
      return zonedTimeToUtc(
        { year: parts.year, month: parts.month, day: parts.day, hour: startHour, minute: startMinute },
        window.timezone,
      );
    }

    if (minutesOfDay >= window.endMinutes) {
      const next = shiftCalendarDays(parts, 1);
      cursor = zonedTimeToUtc({ ...next, hour: startHour, minute: startMinute }, window.timezone);
      continue;
    }

    return cursor;
  }

  return cursor;
}

/** True when `instant` sits inside the window on an allowed day. */
export function isWithinSendWindow(instant: Date, window: SendWindow): boolean {
  const parts = zonedParts(instant, window.timezone);
  if (window.businessDaysOnly && isWeekend(parts.weekday)) return false;
  const minutesOfDay = parts.hour * 60 + parts.minute;
  return minutesOfDay >= window.startMinutes && minutesOfDay < window.endMinutes;
}

/**
 * Advance by a wait step, then snap into the sending window.
 *
 * When the sequence is business-days-only, `days` counts BUSINESS days — "wait
 * 3 days" set on a Thursday lands the following Tuesday, which is what someone
 * configuring a follow-up cadence means.
 */
export function addDelay(from: Date, days: number, hours: number, window: SendWindow): Date {
  let target: Date;

  if (window.businessDaysOnly && days > 0) {
    const parts = zonedParts(from, window.timezone);
    const shifted = shiftBusinessDays(parts, days);
    target = zonedTimeToUtc({ ...shifted, hour: parts.hour, minute: parts.minute }, window.timezone);
  } else {
    target = new Date(from.getTime() + days * DAY_MS);
  }

  if (hours > 0) target = new Date(target.getTime() + hours * HOUR_MS);
  return nextSendSlot(target, window);
}

export type SequenceStepLite = {
  id: string;
  stepOrder: number;
  kind: "email" | "wait";
  delayDays: number;
  delayHours: number;
};

/**
 * Find the next email step after `afterOrder`, summing any wait steps in
 * between, and return when it should run.
 *
 * Shared by the enroll route (day-0 scheduling) and the cron (advancing after a
 * send) so the two paths cannot drift apart.
 */
export function planNextEmailStep(
  steps: SequenceStepLite[],
  afterOrder: number,
  from: Date,
  window: SendWindow,
): { stepId: string; runAt: Date } | null {
  const ordered = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  let waitDays = 0;
  let waitHours = 0;

  for (const step of ordered) {
    if (step.stepOrder <= afterOrder) continue;

    if (step.kind === "wait") {
      waitDays += step.delayDays;
      waitHours += step.delayHours;
      continue;
    }

    const runAt =
      waitDays > 0 || waitHours > 0
        ? addDelay(from, waitDays, waitHours, window)
        : nextSendSlot(from, window);
    return { stepId: step.id, runAt };
  }

  return null;
}

/**
 * Spread a batch's first send over up to 30 minutes. Without this, enrolling 80
 * recipients queues them all at exactly 09:00:00 and they hit Gmail as one burst.
 */
export function jitteredStart(runAt: Date, maxJitterMinutes = 30): Date {
  return new Date(runAt.getTime() + Math.floor(Math.random() * maxJitterMinutes * MINUTE_MS));
}

/** "3 business days", "2 days 4 hours", "6 hours" — for the wait-step UI. */
export function describeDelay(days: number, hours: number, businessDaysOnly: boolean): string {
  const bits: string[] = [];
  if (days > 0) {
    const unit = days === 1 ? "day" : "days";
    bits.push(businessDaysOnly ? `${days} business ${unit}` : `${days} ${unit}`);
  }
  if (hours > 0) bits.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  return bits.length ? bits.join(" ") : "no delay";
}

/** Renders an instant in the sequence's own timezone, e.g. "Tue, 12 Aug, 9:00 am". */
export function formatInTimeZone(instant: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(instant);
  } catch {
    return instant.toISOString();
  }
}

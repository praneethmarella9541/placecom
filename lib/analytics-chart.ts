/**
 * Chart helpers for the admin analytics: grouping a day-by-day series into
 * readable bars, and round axis ticks. Pure, so it is unit-testable.
 */

/** One day: emails sent, and what has become of them since. */
export type DayPoint = { date: string; sent: number; opened: number; replied: number; bounced: number };

/** One day of a member's series as the analytics API returns it. */
export type ApiDayPoint = { date: string; messages: number; opened?: number; replied?: number; bounced?: number };

/** API series → chart points. */
export function apiSeriesToPoints(series: ApiDayPoint[]): DayPoint[] {
  return series.map((d) => ({
    date: d.date,
    sent: d.messages,
    opened: d.opened ?? 0,
    replied: d.replied ?? 0,
    bounced: d.bounced ?? 0,
  }));
}

/** Average emails per member for each day (in `sent`) — the reference line on a member's chart. */
export function teamAveragePoints(memberSeries: ApiDayPoint[][]): DayPoint[] {
  const first = memberSeries[0];
  if (!first || memberSeries.length === 0) return [];
  return first.map((d, i) => ({
    date: d.date,
    sent: memberSeries.reduce((n, series) => n + (series[i]?.messages ?? 0), 0) / memberSeries.length,
    opened: 0,
    replied: 0,
    bounced: 0,
  }));
}

/** `n` as a share of `of`, as "40%"; "—" when there is nothing to divide by. */
export function percent(n: number, of: number): string {
  if (!of) return "—";
  const value = (n / of) * 100;
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)}%`;
}

export type Bucket = {
  key: string;
  /** Short axis label: "7 Oct", or "Oct" for a month. */
  label: string;
  /** Full period for the tooltip: "2 Oct – 8 Oct 2026". */
  rangeLabel: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
};

export type BucketUnit = "day" | "week" | "month";

/** "7 Oct" / "7 Oct 2026", printed in UTC so a date never shifts with the viewer's zone. */
export function formatUtcDay(isoDay: string, withYear = false): string {
  return new Date(`${isoDay}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

function formatUtcMonth(isoDay: string): string {
  return new Date(`${isoDay}T00:00:00.000Z`).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function makeBucket(key: string, label: string, rangeLabel: string, days: DayPoint[]): Bucket {
  const sum = (pick: (d: DayPoint) => number) => days.reduce((n, d) => n + pick(d), 0);
  return {
    key,
    label,
    rangeLabel,
    sent: sum((d) => d.sent),
    opened: sum((d) => d.opened),
    replied: sum((d) => d.replied),
    bounced: sum((d) => d.bounced),
  };
}

/**
 * Which unit keeps the bar count readable: a bar per day up to `dayMax` days,
 * a bar per week up to `weekMax`, a bar per month beyond that. A fixed bar
 * count (rather than a fixed bar width) is what stops a chart from growing as
 * the date range does.
 */
export function pickUnit(dayCount: number, opts: { dayMax: number; weekMax: number }): BucketUnit {
  if (dayCount <= opts.dayMax) return "day";
  if (dayCount <= opts.weekMax) return "week";
  return "month";
}

export function bucketPoints(
  points: DayPoint[],
  opts: { dayMax: number; weekMax: number }
): { unit: BucketUnit; buckets: Bucket[] } {
  const unit = pickUnit(points.length, opts);

  if (unit === "day") {
    return {
      unit,
      buckets: points.map((p) => makeBucket(p.date, formatUtcDay(p.date), formatUtcDay(p.date, true), [p])),
    };
  }

  if (unit === "week") {
    const buckets: Bucket[] = [];
    for (let i = 0; i < points.length; i += 7) {
      const chunk = points.slice(i, i + 7);
      const first = chunk[0].date;
      const last = chunk[chunk.length - 1].date;
      buckets.push(
        makeBucket(
          first,
          formatUtcDay(first),
          first === last ? formatUtcDay(first, true) : `${formatUtcDay(first)} – ${formatUtcDay(last, true)}`,
          chunk
        )
      );
    }
    return { unit, buckets };
  }

  const byMonth = new Map<string, DayPoint[]>();
  for (const p of points) {
    const key = p.date.slice(0, 7);
    const list = byMonth.get(key);
    if (list) list.push(p);
    else byMonth.set(key, [p]);
  }
  const buckets: Bucket[] = [];
  byMonth.forEach((days, key) => {
    const monthLabel = formatUtcMonth(days[0].date);
    buckets.push(makeBucket(key, monthLabel.split(" ")[0], monthLabel, days));
  });
  return { unit, buckets };
}

/**
 * Round, whole-number axis ticks from 0 up to just above `max`: the smallest
 * 1/2/5 × 10ⁿ step that needs at most four intervals, so the tallest bar uses
 * most of the height instead of stopping well short of the top tick.
 */
export function niceTicks(max: number): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  let step = 1;
  search: for (let magnitude = 1; magnitude <= 1e12; magnitude *= 10) {
    for (const m of [1, 2, 5]) {
      if (Math.ceil(max / (m * magnitude)) <= 4) {
        step = m * magnitude;
        break search;
      }
    }
  }
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

/** "Today", "Yesterday", "3 days ago", or "7 Oct 2026" for older ones; "—" when there is no date. */
export function relativeDay(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "—";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= 14) return `${days} days ago`;
  return then.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** One CSV cell: quoted when needed, and a leading = + - @ is defused so a spreadsheet can't run it as a formula. */
export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && typeof value !== "number") text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

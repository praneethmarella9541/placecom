"use client";

import { useMemo } from "react";

export type DateRange = { from: string; to: string; allTime?: boolean };

function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD strings. */
export function rangeDayCount({ from, to }: DateRange): number {
  const f = new Date(`${from}T00:00:00.000Z`).getTime();
  const t = new Date(`${to}T00:00:00.000Z`).getTime();
  if (Number.isNaN(f) || Number.isNaN(t)) return 0;
  return Math.round((t - f) / (24 * 60 * 60 * 1000)) + 1;
}

/** Range ending today, N days inclusive. */
export function rangeEndingToday(days: number): DateRange {
  const to = todayUtc();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDate(from), to: isoDate(to) };
}

const PRESETS: { label: string; days?: number; allTime?: boolean }[] = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", allTime: true },
];

export function allTimeRange(): DateRange {
  return { from: "", to: "", allTime: true };
}

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const days = useMemo(() => (value.allTime ? null : rangeDayCount(value)), [value]);
  const activePreset = PRESETS.find((p) => {
    if (p.allTime) return value.allTime === true;
    if (!p.days) return false;
    const r = rangeEndingToday(p.days);
    return !value.allTime && r.from === value.from && r.to === value.to;
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
        {!value.allTime ? (
          <>
            <input
              data-testid="date-range-from"
              type="date"
              value={value.from}
              max={value.to}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value, allTime: false })}
              className="bg-transparent text-xs text-[var(--color-text)] outline-none"
            />
            <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
            <input
              data-testid="date-range-to"
              type="date"
              value={value.to}
              min={value.from}
              max={isoDate(todayUtc())}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value, allTime: false })}
              className="bg-transparent text-xs text-[var(--color-text)] outline-none"
            />
          </>
        ) : (
          <span className="px-1 text-xs font-medium text-[var(--color-text)]">All time</span>
        )}
      </div>
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            data-testid={`date-preset-${p.label.toLowerCase().replace(/\s+/g, "-")}`}
            type="button"
            onClick={() => onChange(p.allTime ? allTimeRange() : rangeEndingToday(p.days!))}
            className={
              "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors " +
              ((p.allTime && value.allTime) || activePreset?.label === p.label
                ? "border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]")
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      <span className="text-[11px] text-[var(--color-text-muted)]">
        {value.allTime ? "All time" : `${days} day${days === 1 ? "" : "s"}`}
      </span>
    </div>
  );
}

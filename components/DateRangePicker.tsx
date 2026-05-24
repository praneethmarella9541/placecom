"use client";

import { useMemo } from "react";

export type DateRange = { from: string; to: string };

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

const PRESETS: { label: string; days: number }[] = [
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const days = useMemo(() => rangeDayCount(value), [value]);
  const activePreset = PRESETS.find((p) => {
    const r = rangeEndingToday(p.days);
    return r.from === value.from && r.to === value.to;
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1">
        <input
          type="date"
          value={value.from}
          max={value.to}
          onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
          className="bg-transparent text-xs text-[var(--color-text)] outline-none"
        />
        <span className="text-[10px] text-[var(--color-text-muted)]">to</span>
        <input
          type="date"
          value={value.to}
          min={value.from}
          max={isoDate(todayUtc())}
          onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
          className="bg-transparent text-xs text-[var(--color-text)] outline-none"
        />
      </div>
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(rangeEndingToday(p.days))}
            className={
              "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors " +
              (activePreset?.days === p.days
                ? "border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                : "border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]")
            }
          >
            {p.label}
          </button>
        ))}
      </div>
      <span className="text-[11px] text-[var(--color-text-muted)]">
        {days} day{days === 1 ? "" : "s"}
      </span>
    </div>
  );
}

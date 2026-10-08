"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateRangeCalendar } from "@/components/DateRangeCalendar";

export type DateRange = { from: string; to: string; allTime?: boolean };

/** Today as a YYYY-MM-DD string in the viewer's own time zone (not UTC, which lags a day for part of the morning in India). */
function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(isoDay: string, delta: number): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
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
  const to = todayLocal();
  return { from: addDays(to, -(days - 1)), to };
}

/** The analytics API shortens a custom range past this (All time is exempt), so the picker refuses it up front. */
const MAX_CUSTOM_DAYS = 180;

export function allTimeRange(): DateRange {
  return { from: "", to: "", allTime: true };
}

const PRESETS: { key: string; label: string; days?: number; allTime?: boolean }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "14d", label: "14 days", days: 14 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "all", label: "All time", allTime: true },
];

/** "7 Oct" / "7 Oct 2026". Parsed and printed in UTC so the day never shifts with the viewer's zone. */
function formatDay(isoDay: string, withYear: boolean): string {
  const d = new Date(`${isoDay}T00:00:00.000Z`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

function formatRange({ from, to }: DateRange): string {
  return from === to ? formatDay(from, true) : `${formatDay(from, from.slice(0, 4) !== to.slice(0, 4))} – ${formatDay(to, true)}`;
}

/**
 * Date range filter: one segmented row of presets, plus a "Custom range"
 * button that opens a small popover with From / To and an Apply button — so
 * the page reloads once per choice, not on every date field edit.
 */
export function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const activePreset = PRESETS.find((p) => {
    if (p.allTime) return value.allTime === true;
    if (!p.days || value.allTime) return false;
    const r = rangeEndingToday(p.days);
    return r.from === value.from && r.to === value.to;
  });
  const customActive = !value.allTime && !activePreset;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openCustom() {
    // Start from what's on screen; from "All time" there is nothing to start from, so offer the last 14 days.
    const start = value.allTime ? rangeEndingToday(14) : value;
    setDraftFrom(start.from);
    setDraftTo(start.to);
    setOpen((v) => !v);
  }

  const today = todayLocal();
  // The calendar only allows a valid range (start first, end within the cap),
  // so a complete draft is always applicable.
  const canApply = Boolean(draftFrom && draftTo);

  function apply() {
    if (!canApply) return;
    onChange({ from: draftFrom, to: draftTo });
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Date range"
        className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-1"
      >
        {PRESETS.map((p) => {
          const active = activePreset?.key === p.key;
          return (
            <button
              key={p.key}
              type="button"
              data-testid={`date-preset-${p.key}`}
              aria-pressed={active}
              onClick={() => {
                setOpen(false);
                onChange(p.allTime ? allTimeRange() : rangeEndingToday(p.days!));
              }}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
                active
                  ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        data-testid="date-range-custom"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={openCustom}
        className={cn(
          "inline-flex h-[42px] items-center gap-2 rounded-xl border px-3.5 text-[13px] font-semibold transition-colors",
          customActive
            ? "border-[var(--color-copper)] bg-[var(--color-copper-tint)] text-[var(--color-copper)]"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        )}
      >
        <CalendarDays className="h-4 w-4" aria-hidden />
        {customActive ? formatRange(value) : "Custom range"}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Custom date range"
          className="absolute left-0 top-full z-30 mt-2 w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xl sm:left-auto sm:right-0 sm:w-[36rem]"
        >
          <DateRangeCalendar
            value={{ from: draftFrom, to: draftTo }}
            onChange={(next) => {
              setDraftFrom(next.from);
              setDraftTo(next.to);
            }}
            max={today}
            maxSpanDays={MAX_CUSTOM_DAYS}
          />
          <p className="mt-3 text-[12.5px] text-[var(--color-text-muted)]" aria-live="polite">
            {draftFrom && draftTo
              ? `${formatRange({ from: draftFrom, to: draftTo })} · ${rangeDayCount({ from: draftFrom, to: draftTo })} day${rangeDayCount({ from: draftFrom, to: draftTo }) === 1 ? "" : "s"}`
              : draftFrom
                ? `From ${formatRange({ from: draftFrom, to: draftFrom })} — now pick the last day (up to ${MAX_CUSTOM_DAYS} days)`
                : "Pick the first day"}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost px-3" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="date-range-apply"
              className="btn-primary-copper px-4"
              disabled={!canApply}
              onClick={apply}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * In-app date-range calendar (no browser date inputs): two months side by side
 * (one on small screens), click a start day then an end day, with the range
 * previewed on hover. Days after `max`, and days more than `maxSpanDays` after
 * a chosen start, are disabled. Arrow keys move between days, Enter/Space picks.
 *
 * Days are "YYYY-MM-DD" strings handled in UTC, so no time zone can shift them.
 */

type Draft = { from: string; to: string };

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
/** First day of the month containing `iso`, shifted by `delta` months. */
function monthStart(iso: string, delta = 0): string {
  const d = toDate(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1)));
}
function monthLabel(iso: string): string {
  return toDate(iso).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}
function longLabel(iso: string): string {
  return toDate(iso).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The 6×7 grid of days shown for a month (leading/trailing days are null). */
function monthGrid(firstOfMonth: string): (string | null)[] {
  const first = toDate(firstOfMonth);
  const lead = first.getUTCDay();
  const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 0; d < daysInMonth; d++) cells.push(addDays(firstOfMonth, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function DateRangeCalendar({
  value,
  onChange,
  max,
  maxSpanDays,
}: {
  /** Current draft; `to` is "" while only the start is chosen. */
  value: Draft;
  onChange: (next: Draft) => void;
  /** Latest selectable day (today). */
  max: string;
  /** Longest range allowed, in days (inclusive). */
  maxSpanDays: number;
}) {
  // The right-hand month: the end of the draft, else its start, else today.
  const [viewEnd, setViewEnd] = useState(() => monthStart(value.to || value.from || max));
  const [hover, setHover] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState(value.to || value.from || max);
  const gridRef = useRef<HTMLDivElement>(null);

  const choosingEnd = !!value.from && !value.to;
  const latestEnd = choosingEnd ? minIso(max, addDays(value.from, maxSpanDays - 1)) : max;

  function isDisabled(day: string): boolean {
    if (day > max) return true;
    if (choosingEnd && day >= value.from && day > latestEnd) return true;
    return false;
  }

  function pick(day: string) {
    if (isDisabled(day)) return;
    if (!value.from || value.to || day < value.from) {
      onChange({ from: day, to: "" });
    } else {
      onChange({ from: value.from, to: day });
    }
    setFocusDay(day);
  }

  // The range to paint: the chosen one, or start → hovered day while choosing.
  const paintEnd = value.to || (choosingEnd && hover && hover >= value.from && !isDisabled(hover) ? hover : "");
  const inRange = (day: string) => !!value.from && !!paintEnd && day >= value.from && day <= paintEnd;

  // After an arrow-key move: bring the focused day's month into view, then
  // focus it. Only for keyboard moves — the month arrows must stay free to
  // page away from the focused day.
  const keyboardMoved = useRef(false);
  useEffect(() => {
    if (!keyboardMoved.current) return;
    if (focusDay < monthStart(viewEnd, -1)) {
      setViewEnd(monthStart(focusDay, 1));
      return;
    }
    if (focusDay >= monthStart(viewEnd, 1)) {
      setViewEnd(monthStart(focusDay));
      return;
    }
    keyboardMoved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus();
  }, [focusDay, viewEnd]);

  function onKeyDown(e: React.KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      keyboardMoved.current = true;
      setFocusDay((d) => addDays(d, moves[e.key]));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(focusDay);
    }
  }

  const months = useMemo(() => [monthStart(viewEnd, -1), viewEnd], [viewEnd]);
  const canGoForward = monthStart(viewEnd, 1) <= monthStart(max);

  return (
    <div ref={gridRef} onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)}>
      <div className="flex gap-6">
        {months.map((first, idx) => (
          <div key={first} className={cn("min-w-0 flex-1", idx === 0 && "hidden sm:block")}>
            <div className="mb-2 flex h-8 items-center justify-between">
              {idx === 0 || months.length === 1 ? (
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setViewEnd((v) => monthStart(v, -1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() => setViewEnd((v) => monthStart(v, -1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] sm:invisible"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <p className="text-[13px] font-semibold text-[var(--color-text)]">{monthLabel(first)}</p>
              {idx === 1 ? (
                <button
                  type="button"
                  aria-label="Next month"
                  disabled={!canGoForward}
                  onClick={() => setViewEnd((v) => monthStart(v, 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <span className="h-8 w-8" />
              )}
            </div>

            <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-[var(--color-text-faint)]">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1">
                  {w}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5" role="grid" aria-label={monthLabel(first)}>
              {monthGrid(first).map((day, i) => {
                if (!day) return <span key={`blank-${i}`} />;
                const disabled = isDisabled(day);
                const isStart = day === value.from;
                const isEnd = day === paintEnd;
                const between = inRange(day) && !isStart && !isEnd;
                const isToday = day === max;
                return (
                  <div
                    key={day}
                    className={cn(
                      "flex justify-center",
                      // The tinted band joining start and end.
                      inRange(day) && value.from !== paintEnd && "bg-[var(--color-copper-tint)]",
                      isStart && paintEnd && value.from !== paintEnd && "rounded-l-full",
                      isEnd && value.from !== paintEnd && "rounded-r-full"
                    )}
                  >
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focusDay ? 0 : -1}
                      disabled={disabled}
                      aria-label={longLabel(day)}
                      aria-pressed={isStart || isEnd}
                      onClick={() => pick(day)}
                      onMouseEnter={() => setHover(day)}
                      onFocus={() => setFocusDay(day)}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full text-[12.5px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-copper)]",
                        isStart || isEnd
                          ? "bg-[var(--color-copper)] font-semibold text-white"
                          : between
                            ? "text-[var(--color-text)]"
                            : "text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]",
                        isToday && !(isStart || isEnd) && "font-semibold ring-1 ring-inset ring-[var(--color-copper)]",
                        disabled && "cursor-not-allowed text-[var(--color-text-faint)] opacity-40 hover:bg-transparent"
                      )}
                    >
                      {toDate(day).getUTCDate()}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

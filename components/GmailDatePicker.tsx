"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import {
  formatGmailDisplayDate,
  isoDateLocal,
  parseIsoDateLocal,
} from "@/lib/gmail-search-query";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type Props = {
  value: string;
  onChange: (isoDate: string) => void;
  className?: string;
  placeholder?: string;
};

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Gmail-style date field with a custom month grid (no native date input). */
export function GmailDatePicker({ value, onChange, className, placeholder = "YYYY/MM/DD" }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => (value ? parseIsoDateLocal(value) : null), [value]);
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [viewYear, setViewYear] = useState(() => (selected ?? today).getFullYear());
  const [viewMonth, setViewMonth] = useState(() => (selected ?? today).getMonth());

  useEffect(() => {
    if (!open) return;
    const anchor = selected ?? today;
    setViewYear(anchor.getFullYear());
    setViewMonth(anchor.getMonth());
  }, [open, selected, today]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const cells = useMemo(() => {
    const first = startOfMonth(viewYear, viewMonth);
    const startPad = first.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const items: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < startPad; i++) {
      const d = new Date(viewYear, viewMonth, -(startPad - 1 - i));
      items.push({ date: d, inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      items.push({ date: new Date(viewYear, viewMonth, day), inMonth: true });
    }
    while (items.length % 7 !== 0) {
      const last = items[items.length - 1]!.date;
      const d = new Date(last);
      d.setDate(d.getDate() + 1);
      items.push({ date: d, inMonth: false });
    }
    return items;
  }, [viewYear, viewMonth]);

  function pick(d: Date) {
    onChange(isoDateLocal(d));
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }

  const display = value ? formatGmailDisplayDate(value) : "";

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "input-field flex h-9 w-full items-center gap-2 px-2 text-left text-[13px]",
          !display && "text-[var(--color-text-faint)]",
        )}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="min-w-0 flex-1 truncate">{display || placeholder}</span>
        <Calendar className="h-4 w-4 shrink-0 text-[#5f6368]" strokeWidth={2} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose date"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 rounded-lg border border-[#dadce0] bg-white p-3 shadow-[0_4px_16px_rgba(60,64,67,0.28)]"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-[14px] font-medium text-[#202124]">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-medium text-[#5f6368]">
            {WEEKDAYS.map((d, i) => (
              <span key={`${d}-${i}`} className="py-1">
                {d}
              </span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-0.5">
            {cells.map(({ date, inMonth }) => {
              const isSelected = selected ? sameDay(date, selected) : false;
              const isToday = sameDay(date, today);
              return (
                <button
                  key={date.toISOString()}
                  type="button"
                  onClick={() => pick(date)}
                  className={cn(
                    "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[13px] transition-colors",
                    !inMonth && "text-[#9aa0a6]",
                    inMonth && "text-[#202124]",
                    isToday && !isSelected && "font-semibold text-[#0b57d0]",
                    isSelected && "bg-[#0b57d0] font-medium text-white",
                    !isSelected && inMonth && "hover:bg-[#f1f3f4]",
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex justify-between border-t border-[#f1f3f4] pt-2">
            <button
              type="button"
              onClick={() => pick(today)}
              className="text-[12px] font-medium text-[#0b57d0] hover:underline"
            >
              Today
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
                className="text-[12px] text-[#5f6368] hover:underline"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

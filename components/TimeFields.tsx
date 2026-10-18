"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const timeFieldClass =
  "h-10 w-14 rounded-xl border border-transparent bg-[var(--color-surface-2)] px-2 text-center text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-copper)] disabled:opacity-50";

/**
 * Any time, typed: hour and minute fields plus an AM/PM switch. Text is committed when a field is
 * left (or Enter), so a half-typed "1" on the way to "11" never lands as a start time.
 */
export function TimeFields({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const h24 = Number(value.slice(0, 2)) || 0;
  const pm = h24 >= 12;
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minute = value.slice(3, 5) || "00";
  const [hourText, setHourText] = useState(String(hour12));
  const [minuteText, setMinuteText] = useState(minute);
  useEffect(() => setHourText(String(hour12)), [hour12]);
  useEffect(() => setMinuteText(minute), [minute]);

  const emit = (h: number, m: number, isPm: boolean) =>
    onChange(`${String((h % 12) + (isPm ? 12 : 0)).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  const commitHour = () => {
    const n = Math.min(12, Math.max(1, Math.round(Number(hourText)) || hour12));
    setHourText(String(n));
    emit(n, Number(minute), pm);
  };
  const commitMinute = () => {
    const n = Math.min(59, Math.max(0, Math.round(Number(minuteText)) || 0));
    setMinuteText(String(n).padStart(2, "0"));
    emit(hour12, n, pm);
  };
  const enterToCommit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        inputMode="numeric"
        maxLength={2}
        value={hourText}
        disabled={disabled}
        onChange={(e) => setHourText(e.target.value.replace(/\D/g, ""))}
        onFocus={(e) => e.target.select()}
        onBlur={commitHour}
        onKeyDown={enterToCommit}
        className={timeFieldClass}
        aria-label="Start hour"
      />
      <span className="text-[13px] text-[var(--color-text-faint)]">:</span>
      <input
        inputMode="numeric"
        maxLength={2}
        value={minuteText}
        disabled={disabled}
        onChange={(e) => setMinuteText(e.target.value.replace(/\D/g, ""))}
        onFocus={(e) => e.target.select()}
        onBlur={commitMinute}
        onKeyDown={enterToCommit}
        className={timeFieldClass}
        aria-label="Start minute"
      />
      <div className="ml-1 flex rounded-xl bg-[var(--color-surface-2)] p-0.5" role="radiogroup" aria-label="AM or PM">
        {[false, true].map((isPm) => (
          <button
            key={String(isPm)}
            type="button"
            role="radio"
            aria-checked={pm === isPm}
            disabled={disabled}
            onClick={() => emit(hour12, Number(minute), isPm)}
            className={cn(
              "h-9 rounded-[10px] px-3 text-[13px] font-medium transition-colors disabled:opacity-50",
              pm === isPm
                ? "bg-[var(--color-surface)] text-[var(--color-copper)] shadow-sm"
                : "text-[var(--color-text-muted)]",
            )}
          >
            {isPm ? "PM" : "AM"}
          </button>
        ))}
      </div>
    </div>
  );
}

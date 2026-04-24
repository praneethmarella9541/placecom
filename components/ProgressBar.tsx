"use client";

import { cn } from "@/lib/utils";

type Props = {
  value: number;
  max: number;
  className?: string;
  label?: string;
  /** Short hint under the bar (e.g. how often progress updates). */
  hint?: string;
  indeterminate?: boolean;
};

export function ProgressBar({ value, max, className, label, hint, indeterminate }: Props) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div className={cn("w-full space-y-2", className)}>
      {label ? (
        <div className="flex justify-between gap-3 text-sm">
          <span className="min-w-0 font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
          {!indeterminate && (
            <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
              {value} / {max} <span className="text-xs">({pct}%)</span>
            </span>
          )}
        </div>
      ) : null}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={cn(
            "h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-[width] duration-500 ease-out",
            indeterminate && "w-2/5 animate-[pulse_1.5s_ease-in-out_infinite]"
          )}
          style={!indeterminate ? { width: `${pct}%` } : undefined}
        />
      </div>
      {hint ? (
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  );
}

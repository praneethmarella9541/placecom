"use client";

/**
 * A row's trend, drawn in a fixed-width box however long the range is: the bar
 * count is capped (days, weeks or months) instead of letting width grow with the
 * number of days. Every row shares one scale (`max`), so a quiet member looks
 * quiet next to a busy one.
 */
export function Sparkline({ buckets, max, label }: { buckets: { key: string; rangeLabel: string; sent: number }[]; max: number; label: string }) {
  return (
    <div
      className="flex h-8 w-40 items-end gap-px border-b border-[var(--color-border)]"
      role="img"
      aria-label={label}
    >
      {buckets.map((b) => (
        <div
          key={b.key}
          title={`${b.rangeLabel}: ${b.sent} email${b.sent === 1 ? "" : "s"}`}
          className="min-w-[2px] flex-1 rounded-t-[2px] bg-[#2a78d6]"
          style={{ height: b.sent === 0 ? 0 : `${Math.max(8, (b.sent / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton for the Calendar route — toolbar (date nav + view switcher),
 * day-name header strip, then a week-grid placeholder of time-slot bars.
 */
export default function CalendarLoading() {
  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] -mb-6 flex h-[calc(100dvh-56px-24px)] min-h-0 flex-col overflow-hidden md:-mx-6 md:-mt-6 md:h-[calc(100dvh-48px)]">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3 md:px-5">
        <div className="flex items-center gap-2">
          <div className="skeleton-shimmer h-8 w-8 rounded-md" />
          <div className="skeleton-shimmer h-8 w-8 rounded-md" />
          <div className="skeleton-shimmer h-7 w-40 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <div className="skeleton-shimmer h-8 w-8 rounded-md" />
          <div className="skeleton-shimmer h-8 w-24 rounded-md" />
        </div>
      </div>

      {/* Day-name strip */}
      <div className="grid shrink-0 grid-cols-8 border-b border-[var(--color-border)]">
        <div className="border-r border-[var(--color-border)]" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-1 border-r border-[var(--color-border)] py-2 last:border-r-0"
          >
            <div className="skeleton-shimmer h-2.5 w-8 rounded" />
            <div className="skeleton-shimmer h-6 w-6 rounded-full" />
          </div>
        ))}
      </div>

      {/* Time-grid placeholder */}
      <div className="flex-1 overflow-hidden">
        <div className="grid h-full grid-cols-8">
          {/* Time gutter */}
          <div className="flex flex-col gap-12 border-r border-[var(--color-border)] py-3 pr-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton-shimmer ml-auto h-2.5 w-12 rounded" />
            ))}
          </div>
          {/* Day columns */}
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <div
              key={d}
              className="relative border-r border-[var(--color-border)] last:border-r-0"
            >
              {/* A couple of sparse "event" placeholders */}
              {d === 1 && (
                <div
                  className="skeleton-shimmer absolute left-1 right-1 h-12 rounded"
                  style={{ top: "12%" }}
                />
              )}
              {d === 3 && (
                <div
                  className="skeleton-shimmer absolute left-1 right-1 h-20 rounded"
                  style={{ top: "30%" }}
                />
              )}
              {d === 4 && (
                <div
                  className="skeleton-shimmer absolute left-1 right-1 h-14 rounded"
                  style={{ top: "55%" }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

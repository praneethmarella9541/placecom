/**
 * Skeleton for the Admin → Analytics route — header (title + date range),
 * then a wide stats table (User / Calls / Talk mins / Msgs / Tokens / Trend).
 */
export default function AdminAnalyticsLoading() {
  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="skeleton-shimmer h-7 w-48 rounded" />
          <div className="skeleton-shimmer mt-1.5 h-3 w-72 rounded" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="skeleton-shimmer h-9 w-56 rounded-md" />
          <div className="skeleton-shimmer h-8 w-20 rounded-md" />
        </div>
      </header>

      {/* Stats table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_2fr] gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3">
          {["User", "Calls in", "Calls out", "Talk mins", "Msgs sent", "Tokens", "Trend"].map(
            (h) => (
              <div key={h} className="skeleton-shimmer h-3 w-16 rounded" />
            ),
          )}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_2fr] items-center gap-4 border-b border-[var(--color-border)] px-4 py-3 last:border-b-0"
          >
            <div>
              <div className="skeleton-shimmer h-3.5 w-32 rounded" />
              <div className="skeleton-shimmer mt-1.5 h-2.5 w-40 rounded" />
            </div>
            <div className="skeleton-shimmer ml-auto h-3 w-6 rounded" />
            <div className="skeleton-shimmer ml-auto h-3 w-6 rounded" />
            <div className="skeleton-shimmer ml-auto h-3 w-8 rounded" />
            <div className="skeleton-shimmer ml-auto h-3 w-6 rounded" />
            <div className="skeleton-shimmer ml-auto h-3 w-10 rounded" />
            <div className="skeleton-shimmer h-8 w-full rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

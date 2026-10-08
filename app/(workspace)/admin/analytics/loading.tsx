/**
 * Skeleton for the Admin → Analytics route — header, four summary cards, the
 * chart, then the members card. Same shapes as the page, so nothing shifts when it loads.
 */
export default function AdminAnalyticsLoading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="space-y-1.5">
        <div className="skeleton-shimmer h-8 w-20 rounded-lg" />
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <div className="skeleton-shimmer h-7 w-48 rounded" />
            <div className="skeleton-shimmer h-3.5 w-72 rounded" />
          </div>
          <div className="skeleton-shimmer h-[42px] w-[26rem] max-w-full rounded-xl" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton-shimmer h-[92px] rounded-2xl" />
        ))}
      </div>

      <div className="skeleton-shimmer h-[340px] rounded-2xl" />

      <div className="surface-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="space-y-2">
            <div className="skeleton-shimmer h-4 w-24 rounded" />
            <div className="skeleton-shimmer h-3 w-56 rounded" />
          </div>
          <div className="skeleton-shimmer h-9 w-32 rounded-xl" />
        </div>
        <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton-shimmer h-3.5 w-40 rounded" />
                <div className="skeleton-shimmer h-2.5 w-56 rounded" />
              </div>
              <div className="skeleton-shimmer h-3 w-10 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

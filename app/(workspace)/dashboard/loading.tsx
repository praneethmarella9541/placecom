/**
 * Skeleton for the Dashboard (Extraction) route — mirrors the layout:
 * 3 KPI cards, settings card, extraction trigger card, results table.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* 3 KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="surface-card rounded-[var(--radius-lg)] p-5 sm:p-6">
            <div className="skeleton-shimmer h-10 w-20 rounded" />
            <div className="skeleton-shimmer mt-2 h-2.5 w-32 rounded" />
          </div>
        ))}
      </div>

      {/* Settings card */}
      <div className="surface-card rounded-[var(--radius-lg)] p-6">
        <div className="skeleton-shimmer h-4 w-40 rounded" />
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <div className="skeleton-shimmer h-3 w-28 rounded" />
            <div className="skeleton-shimmer mt-2 h-[38px] w-full rounded-md" />
          </div>
          <div className="flex-1">
            <div className="skeleton-shimmer h-3 w-24 rounded" />
            <div className="skeleton-shimmer mt-2 h-[38px] w-full rounded-md" />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <div className="skeleton-shimmer h-9 w-32 rounded-md" />
        </div>
      </div>

      {/* Extraction trigger card */}
      <div className="surface-card rounded-[var(--radius-lg)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="skeleton-shimmer h-3 w-72 rounded" />
          <div className="flex flex-wrap items-center gap-2">
            <div className="skeleton-shimmer h-9 w-36 rounded-md" />
            <div className="skeleton-shimmer h-9 w-24 rounded-md" />
            <div className="skeleton-shimmer h-9 w-32 rounded-md" />
          </div>
        </div>
      </div>

      {/* Results table */}
      <div className="surface-card overflow-hidden rounded-[var(--radius-lg)]">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3">
          <div className="skeleton-shimmer h-4 w-20 rounded" />
        </div>
        <div className="space-y-3 p-6">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton-shimmer h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

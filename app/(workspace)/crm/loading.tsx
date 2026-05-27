/**
 * Skeleton for the CRM funnel route — mirrors the layout: header row
 * (title + segmented tabs + filters), KPI bar, kanban columns.
 */
export default function CrmLoading() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="skeleton-shimmer h-6 w-48 rounded" />
          <div className="skeleton-shimmer h-9 w-72 rounded-md" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="skeleton-shimmer h-[34px] w-40 rounded-md" />
          <div className="skeleton-shimmer h-[34px] w-32 rounded-md" />
          <div className="skeleton-shimmer h-[34px] w-28 rounded-md" />
          <div className="skeleton-shimmer h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* KPI bar */}
      <div className="surface-card inline-flex flex-wrap items-center gap-4 rounded-[var(--radius-md)] px-4 py-3">
        <div>
          <div className="skeleton-shimmer h-2.5 w-40 rounded" />
          <div className="skeleton-shimmer mt-2 h-6 w-24 rounded" />
        </div>
        <div className="skeleton-shimmer h-3 w-56 rounded" />
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((col) => (
          <div
            key={col}
            className="surface-card flex flex-col gap-3 rounded-[var(--radius-lg)] p-3"
          >
            <div className="flex items-center justify-between">
              <div className="skeleton-shimmer h-3.5 w-24 rounded" />
              <div className="skeleton-shimmer h-5 w-7 rounded-full" />
            </div>
            {[0, 1, 2, 3].map((card) => (
              <div
                key={card}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3"
              >
                <div className="skeleton-shimmer h-3.5 w-32 rounded" />
                <div className="skeleton-shimmer mt-2 h-3 w-48 rounded" />
                <div className="mt-3 flex items-center gap-2">
                  <div className="skeleton-shimmer h-5 w-12 rounded-full" />
                  <div className="skeleton-shimmer h-5 w-16 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

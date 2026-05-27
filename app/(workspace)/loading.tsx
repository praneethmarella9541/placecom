/**
 * Fallback skeleton shown for workspace routes that don't have their own
 * route-segment `loading.tsx`. Mimics a generic content-page shape:
 * page title, top action bar, a primary card, then a stack of list rows.
 *
 * Most main routes (inbox/drive/crm/dashboard/meetings/forms/etc.) have
 * their own pixel-matched skeleton — this is the safety net for anything
 * else and for first-paint before the route's own loader takes over.
 */
export default function WorkspaceLoading() {
  return (
    <div className="space-y-6 py-2">
      {/* Page header */}
      <div className="flex items-center justify-between gap-3">
        <div className="skeleton-shimmer h-7 w-56 rounded" />
        <div className="flex items-center gap-2">
          <div className="skeleton-shimmer h-9 w-9 rounded-md" />
          <div className="skeleton-shimmer h-9 w-28 rounded-md" />
        </div>
      </div>

      {/* Primary card */}
      <div className="surface-card rounded-[var(--radius-lg)] p-6">
        <div className="skeleton-shimmer h-4 w-40 rounded" />
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <div className="skeleton-shimmer h-3 w-24 rounded" />
            <div className="skeleton-shimmer mt-2 h-9 w-full rounded-md" />
          </div>
          <div className="flex-1">
            <div className="skeleton-shimmer h-3 w-24 rounded" />
            <div className="skeleton-shimmer mt-2 h-9 w-full rounded-md" />
          </div>
        </div>
      </div>

      {/* List rows */}
      <div className="surface-card overflow-hidden rounded-[var(--radius-lg)]">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3">
          <div className="skeleton-shimmer h-4 w-24 rounded" />
        </div>
        <div className="space-y-3 p-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-shimmer h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

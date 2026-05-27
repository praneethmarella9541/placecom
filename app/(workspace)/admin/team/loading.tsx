/**
 * Skeleton for the Admin → Team route — header (title + analytics link),
 * "Add staff member" form card, and a team-members list.
 */
export default function AdminTeamLoading() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="skeleton-shimmer h-7 w-64 rounded" />
          <div className="skeleton-shimmer h-8 w-32 shrink-0 rounded-md" />
        </div>
        <div className="skeleton-shimmer mt-3 h-3 w-full rounded" />
        <div className="skeleton-shimmer mt-1.5 h-3 w-[88%] rounded" />
      </div>

      {/* Add staff card */}
      <div className="card space-y-3 p-5">
        <div className="skeleton-shimmer h-4 w-40 rounded" />
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="skeleton-shimmer mb-1.5 h-2.5 w-28 rounded" />
            <div className="skeleton-shimmer h-9 w-full rounded-md" />
          </div>
        ))}
        <div className="flex justify-end pt-2">
          <div className="skeleton-shimmer h-9 w-32 rounded-md" />
        </div>
      </div>

      {/* Team list */}
      <div>
        <div className="skeleton-shimmer mb-3 h-4 w-28 rounded" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-3"
            >
              <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="skeleton-shimmer h-3.5 w-40 rounded" />
                <div className="skeleton-shimmer mt-1.5 h-2.5 w-48 rounded" />
              </div>
              <div className="skeleton-shimmer h-7 w-16 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

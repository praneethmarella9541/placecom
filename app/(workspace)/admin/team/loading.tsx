/**
 * Skeleton for the Admin → Team route — page header, tab bar, members cards.
 * Same order and shape as the page, so nothing shifts when it loads.
 */
export default function AdminTeamLoading() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="skeleton-shimmer h-7 w-64 rounded" />
          <div className="skeleton-shimmer h-3.5 w-96 max-w-full rounded" />
        </div>
        <div className="skeleton-shimmer h-9 w-40 shrink-0 rounded-xl" />
      </div>

      <div className="skeleton-shimmer h-11 w-full max-w-md rounded-xl" />

      <div className="card space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="skeleton-shimmer h-3.5 w-80 max-w-full rounded" />
          <div className="skeleton-shimmer h-9 w-40 shrink-0 rounded-md" />
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-shimmer h-7 w-20 rounded-full" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-shimmer h-[104px] rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

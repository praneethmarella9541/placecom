/** Skeleton for the Sequences list — header row, search box, list rows. */
export default function SequencesLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="skeleton-shimmer h-7 w-40 rounded" />
        <div className="skeleton-shimmer h-11 w-28 rounded-xl" />
      </div>
      <div>
        <div className="skeleton-shimmer mb-3 h-10 w-full max-w-sm rounded-xl" />
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-shimmer h-16 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

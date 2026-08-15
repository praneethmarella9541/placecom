/** Skeleton for a sequence detail page — header, tab bar, step cards. */
export default function SequenceDetailLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="skeleton-shimmer h-7 w-56 rounded" />
          <div className="skeleton-shimmer mt-2 h-3 w-40 rounded" />
        </div>
        <div className="skeleton-shimmer h-11 w-32 rounded-xl" />
      </div>
      <div className="skeleton-shimmer h-10 w-full rounded" />
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="skeleton-shimmer h-40 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

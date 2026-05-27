/**
 * Skeleton for the Broadcasting route — header, channel tab bar
 * (Mail / SMS / WhatsApp), then a 2-column form (recipients + message).
 */
export default function BroadcastingLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div>
        <div className="skeleton-shimmer h-7 w-40 rounded" />
        <div className="skeleton-shimmer mt-1.5 h-3 w-full max-w-md rounded" />
      </div>

      {/* Channel tab bar */}
      <div className="inline-flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-800 dark:bg-zinc-900/80">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton-shimmer h-9 w-24 rounded-lg" />
        ))}
      </div>

      {/* Form card */}
      <div className="card space-y-6 p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Recipients */}
          <div className="space-y-4">
            <div className="skeleton-shimmer h-4 w-24 rounded" />
            <div>
              <div className="skeleton-shimmer mb-1.5 h-2.5 w-32 rounded" />
              <div className="skeleton-shimmer h-9 w-32 rounded-md" />
            </div>
            <div>
              <div className="skeleton-shimmer mb-1.5 h-2.5 w-28 rounded" />
              <div className="skeleton-shimmer h-24 w-full rounded-md" />
            </div>
          </div>

          {/* Compose */}
          <div className="space-y-4">
            <div className="skeleton-shimmer h-4 w-20 rounded" />
            <div>
              <div className="skeleton-shimmer mb-1.5 h-2.5 w-16 rounded" />
              <div className="skeleton-shimmer h-9 w-full rounded-md" />
            </div>
            <div>
              <div className="skeleton-shimmer mb-1.5 h-2.5 w-16 rounded" />
              <div className="skeleton-shimmer h-40 w-full rounded-md" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <div className="skeleton-shimmer h-9 w-24 rounded-md" />
          <div className="skeleton-shimmer h-9 w-32 rounded-md" />
        </div>
      </div>
    </div>
  );
}

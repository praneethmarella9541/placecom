/**
 * Skeleton for the WhatsApp route — title + subtitle, then a messaging
 * shell (left thread list + right message pane). Same structure as SMS.
 */
export default function WhatsAppLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="skeleton-shimmer h-7 w-28 rounded" />
        <div className="skeleton-shimmer mt-1.5 h-3 w-80 rounded" />
      </div>
      <div className="surface-card flex h-[600px] overflow-hidden rounded-[var(--radius-lg)]">
        {/* Thread list */}
        <div className="hidden w-[280px] shrink-0 border-r border-[var(--color-border)] sm:block">
          <div className="border-b border-[var(--color-border)] p-3">
            <div className="skeleton-shimmer h-9 w-full rounded-md" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 border-b border-[var(--color-border)] px-3 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="skeleton-shimmer h-3.5 w-28 rounded" />
                <div className="skeleton-shimmer h-2.5 w-10 rounded" />
              </div>
              <div className="skeleton-shimmer h-2.5 w-full rounded" />
            </div>
          ))}
        </div>

        {/* Message pane */}
        <div className="flex flex-1 flex-col">
          <div className="border-b border-[var(--color-border)] p-4">
            <div className="skeleton-shimmer h-4 w-40 rounded" />
            <div className="skeleton-shimmer mt-1.5 h-2.5 w-32 rounded" />
          </div>
          <div className="flex-1 space-y-3 overflow-hidden p-4">
            {[40, 70, 50, 80, 45].map((w, i) => (
              <div
                key={i}
                className="skeleton-shimmer h-10 rounded-xl"
                style={{
                  width: `${w}%`,
                  marginLeft: i % 2 === 0 ? "0" : "auto",
                }}
              />
            ))}
          </div>
          <div className="border-t border-[var(--color-border)] p-3">
            <div className="skeleton-shimmer h-10 w-full rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

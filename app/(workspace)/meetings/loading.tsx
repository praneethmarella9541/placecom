/**
 * Skeleton for the Meetings route — full-bleed master-detail shell:
 * top toolbar (title + sync), left list pane (meeting rows), right
 * detail pane (header + content placeholders).
 */
export default function MeetingsLoading() {
  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100vh-56px)] flex-col overflow-hidden md:-mx-6 md:-mt-6 md:h-screen">
      {/* Top toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 md:px-5">
        <div>
          <div className="skeleton-shimmer h-4 w-24 rounded" />
          <div className="skeleton-shimmer mt-1 h-2.5 w-40 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <div className="skeleton-shimmer h-8 w-8 rounded-lg" />
          <div className="skeleton-shimmer h-8 w-20 rounded-md" />
        </div>
      </div>

      {/* Master-detail */}
      <div className="flex flex-1 overflow-hidden">
        {/* List pane */}
        <div className="hidden w-full shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] md:flex md:w-[300px]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 border-b border-[var(--color-border)] px-4 py-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="skeleton-shimmer h-3.5 w-40 rounded" />
                <div className="skeleton-shimmer h-4 w-12 rounded-full" />
              </div>
              <div className="skeleton-shimmer h-2.5 w-28 rounded" />
              <div className="skeleton-shimmer h-2.5 w-full rounded" />
            </div>
          ))}
        </div>

        {/* Detail pane */}
        <div className="hidden flex-1 flex-col overflow-hidden md:flex">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
            <div>
              <div className="skeleton-shimmer h-5 w-72 rounded" />
              <div className="skeleton-shimmer mt-2 h-2.5 w-48 rounded" />
            </div>
            <div className="skeleton-shimmer h-8 w-24 rounded-md" />
          </div>
          <div className="flex-1 space-y-4 p-6">
            <div className="skeleton-shimmer h-3 w-full rounded" />
            <div className="skeleton-shimmer h-3 w-[92%] rounded" />
            <div className="skeleton-shimmer h-3 w-[88%] rounded" />
            <div className="skeleton-shimmer h-3 w-[78%] rounded" />
            <div className="skeleton-shimmer mt-6 h-3 w-full rounded" />
            <div className="skeleton-shimmer h-3 w-[94%] rounded" />
            <div className="skeleton-shimmer h-3 w-[60%] rounded" />
          </div>
        </div>

        {/* Mobile: only list pane visible */}
        <div className="flex flex-1 flex-col md:hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 border-b border-[var(--color-border)] px-4 py-3"
            >
              <div className="skeleton-shimmer h-3.5 w-40 rounded" />
              <div className="skeleton-shimmer h-2.5 w-28 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

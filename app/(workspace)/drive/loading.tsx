/**
 * Skeleton placeholder for the Drive route — mirrors the actual layout:
 * left sidebar (Drive nav), breadcrumb row, toolbar (search + new folder +
 * upload + refresh), and a list of file rows.
 */
export default function DriveLoading() {
  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100vh-56px)] overflow-hidden md:-mx-6 md:-mt-6 md:h-screen">
      {/* Sidebar */}
      <aside className="hidden w-[208px] shrink-0 flex-col gap-1 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg)] p-2 sm:flex">
        <div className="skeleton-shimmer mx-3 mb-1 mt-3 h-2.5 w-16 rounded" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2">
            <div className="skeleton-shimmer h-4 w-4 shrink-0 rounded" />
            <div className="skeleton-shimmer h-3 w-28 rounded" />
          </div>
        ))}
        <div className="skeleton-shimmer mx-3 mb-1 mt-4 h-2.5 w-24 rounded" />
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-md px-3 py-2">
            <div className="skeleton-shimmer h-4 w-4 shrink-0 rounded" />
            <div className="skeleton-shimmer h-3 w-24 rounded" />
          </div>
        ))}
      </aside>

      {/* Main column */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-surface)]">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 border-b border-[var(--color-border)] px-3 py-2.5">
          <div className="skeleton-shimmer h-6 w-20 rounded-md" />
        </nav>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] p-1.5">
          <div className="min-w-0 flex-1 px-2 py-1">
            <div className="skeleton-shimmer h-9 w-full max-w-md rounded-md" />
          </div>
          <div className="skeleton-shimmer h-9 w-28 shrink-0 rounded-md" />
          <div className="skeleton-shimmer h-9 w-24 shrink-0 rounded-md" />
          <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-md" />
        </div>

        {/* File rows */}
        <div className="space-y-2 p-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="skeleton-shimmer h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

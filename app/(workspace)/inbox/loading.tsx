/**
 * Skeleton placeholder shown while the inbox route streams.
 * Mirrors the real Gmail-style 3-column layout: left rail (compose + folders),
 * center list (category tabs + search + thread rows). Pixel-aligned with
 * the rendered page so the user sees a structural preview, not a generic blob.
 */
export default function InboxLoading() {
  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100vh-56px)] overflow-hidden md:-mx-6 md:-mt-6 md:h-screen">
      {/* Left rail — folders + compose */}
      <aside className="hidden w-[200px] shrink-0 flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] md:flex">
        <div className="flex items-center gap-2 px-3 py-4">
          <div className="skeleton-shimmer h-[38px] flex-1 rounded-md" />
          <div className="skeleton-shimmer h-[38px] w-[38px] shrink-0 rounded-full" />
        </div>
        <div className="flex flex-col gap-1 px-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 py-[7px]">
              <div className="skeleton-shimmer h-[18px] w-[18px] shrink-0 rounded" />
              <div className="skeleton-shimmer h-3 flex-1 rounded" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-1 px-3">
          <div className="skeleton-shimmer mb-1 h-2.5 w-16 rounded" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 py-[7px]">
              <div className="skeleton-shimmer h-3 w-3 shrink-0 rounded-full" />
              <div className="skeleton-shimmer h-3 flex-1 rounded" />
            </div>
          ))}
        </div>
      </aside>

      {/* Center pane — category tabs + search + list */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-surface)]">
        {/* Category tabs */}
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-shimmer h-7 w-20 rounded-md" />
          ))}
        </div>

        {/* Search bar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
          <div className="skeleton-shimmer h-9 flex-1 rounded-full" />
          <div className="skeleton-shimmer h-9 w-9 shrink-0 rounded-full" />
        </div>

        {/* Thread rows */}
        <ul className="flex-1 overflow-y-auto">
          {Array.from({ length: 14 }).map((_, i) => (
            <li
              key={i}
              className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-3"
            >
              <div className="skeleton-shimmer h-3.5 w-3.5 shrink-0 rounded" />
              <div className="skeleton-shimmer h-3.5 w-3.5 shrink-0 rounded" />
              <div className="skeleton-shimmer h-3 w-32 shrink-0 rounded" />
              <div className="skeleton-shimmer h-3 min-w-0 flex-1 rounded" />
              <div className="skeleton-shimmer h-3 w-16 shrink-0 rounded" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

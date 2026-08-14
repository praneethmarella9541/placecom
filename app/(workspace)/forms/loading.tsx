/**
 * Skeleton for the Forms route — header (icon + title), creation card,
 * "Your forms" section with form list rows.
 */
export default function FormsLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="skeleton-shimmer h-12 w-12 shrink-0 rounded-[var(--radius-lg)]" />
        <div className="min-w-0 flex-1">
          <div className="skeleton-shimmer h-7 w-32 rounded" />
          <div className="skeleton-shimmer mt-2 h-3 w-full max-w-md rounded" />
          <div className="skeleton-shimmer mt-1.5 h-3 w-full max-w-sm rounded" />
        </div>
      </div>

      {/* Create-new form card */}
      <div className="surface-card rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <div className="skeleton-shimmer mb-1.5 h-3 w-20 rounded" />
            <div className="skeleton-shimmer h-11 w-full rounded-md" />
          </div>
          <div className="skeleton-shimmer h-11 w-36 shrink-0 rounded-md" />
        </div>
      </div>

      {/* "Your forms" list */}
      <div>
        <div className="skeleton-shimmer mb-3 h-4 w-28 rounded" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="skeleton-shimmer h-16 w-full rounded-[var(--radius-lg)]"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

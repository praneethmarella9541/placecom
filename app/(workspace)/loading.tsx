/** Instant feedback while the next workspace route streams (shared shell stays mounted). */
export default function WorkspaceLoading() {
  return (
    <div className="space-y-6 py-2">
      <div className="skeleton-shimmer h-8 max-w-xs rounded-lg" />
      <div className="skeleton-shimmer h-72 rounded-[var(--radius-xl)]" />
      <div className="flex gap-3">
        <div className="skeleton-shimmer h-10 w-28 rounded-[var(--radius-md)]" />
        <div className="skeleton-shimmer h-10 w-40 rounded-[var(--radius-md)]" />
      </div>
    </div>
  );
}

/** Instant feedback while the next workspace route streams (shared shell stays mounted). */
export default function WorkspaceLoading() {
  return (
    <div className="animate-pulse space-y-6 py-2">
      <div className="h-8 max-w-xs rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      <div className="card h-72 rounded-xl border border-[#E5E7EB] bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40" />
      <div className="flex gap-3">
        <div className="h-10 w-28 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-10 w-40 rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      </div>
    </div>
  );
}

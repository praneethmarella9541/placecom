/** Skeleton for the CRM route — mirrors the current shell: title + one card. */
export default function CrmLoading() {
  return (
    <div className="space-y-5">
      <div className="skeleton-shimmer h-6 w-24 rounded" />
      <div className="surface-card flex flex-col items-center gap-3 px-6 py-16">
        <div className="skeleton-shimmer h-7 w-7 rounded" />
        <div className="skeleton-shimmer h-4 w-40 rounded" />
        <div className="skeleton-shimmer h-3 w-72 rounded" />
      </div>
    </div>
  );
}

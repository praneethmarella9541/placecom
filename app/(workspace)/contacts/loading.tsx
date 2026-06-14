export default function ContactsLoading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="skeleton-shimmer h-8 w-48 rounded" />
        <div className="skeleton-shimmer mt-2 h-4 w-full max-w-md rounded" />
      </div>
      <div className="surface-card rounded-[var(--radius-lg)] p-6">
        <div className="skeleton-shimmer h-4 w-32 rounded" />
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <div className="skeleton-shimmer h-10 flex-1 rounded-md" />
          <div className="skeleton-shimmer h-10 flex-1 rounded-md" />
        </div>
        <div className="mt-4 space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-shimmer h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}

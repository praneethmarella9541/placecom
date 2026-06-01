"use client";

import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import type { ExtractionJob } from "@/types/extraction";

type Props = {
  refreshKey?: number;
  className?: string;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusLabel(status: string): string {
  switch (status) {
    case "done":
      return titleCase("Done");
    case "running":
      return titleCase("Running");
    case "error":
      return titleCase("Error");
    case "pending":
      return titleCase("Pending");
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "done":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
    case "running":
      return "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300";
    case "error":
      return "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300";
    default:
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

export function ExtractionJobHistory({ refreshKey = 0, className }: Props) {
  const [jobs, setJobs] = useState<ExtractionJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      const body = (await res.json()) as { jobs?: ExtractionJob[]; error?: string };
      if (!res.ok) throw new Error(body.error || "Failed to load jobs");
      setJobs(body.jobs ?? []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <div className={className}>
      <h3 className="font-display text-[15px] font-bold text-[var(--color-text)]">
        {titleCase("Job history")}
      </h3>
      <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
        {titleCase("Recent extraction runs for your account.")}
      </p>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="skeleton-shimmer h-10 w-full rounded-md" />
          <Skeleton className="skeleton-shimmer h-10 w-full rounded-md" />
        </div>
      ) : jobs.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          {titleCase("No jobs yet. Start an extraction above.")}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[var(--color-surface-offset)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
              <tr>
                <th className="px-3 py-2">{titleCase("Date")}</th>
                <th className="px-3 py-2">{titleCase("Status")}</th>
                <th className="px-3 py-2 text-right">{titleCase("Emails")}</th>
                <th className="px-3 py-2 text-right">{titleCase("Cost")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {jobs.map((j) => {
                const cost =
                  j.openai_cost_usd != null && Number(j.openai_cost_usd) > 0
                    ? `$${Number(j.openai_cost_usd).toFixed(4)}`
                    : "—";
                return (
                  <tr key={j.id} className="hover:bg-[var(--color-surface-offset)]/60">
                    <td className="whitespace-nowrap px-3 py-2.5 text-[var(--color-text)]">
                      {formatWhen(j.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass(j.status)}`}
                      >
                        {statusLabel(j.status)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">
                      {j.processed_emails}
                      {j.total_emails > 0 ? ` / ${j.total_emails}` : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[var(--color-text-muted)]">
                      {cost}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

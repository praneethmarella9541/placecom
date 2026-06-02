"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Clock, Loader2, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/Skeleton";
import { useExtractionRun } from "@/components/ExtractionRunProvider";
import { jobCanResume } from "@/lib/extraction-types";
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
    case "done":    return titleCase("Done");
    case "running": return titleCase("Running");
    case "error":   return titleCase("Error");
    case "partial": return titleCase("Partial");
    case "pending": return titleCase("Pending");
    default:        return status;
  }
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { icon: React.ElementType; bg: string; text: string }> = {
    done:    { icon: CheckCircle2,   bg: "bg-emerald-100 dark:bg-emerald-950/50", text: "text-emerald-700 dark:text-emerald-300" },
    running: { icon: Loader2,        bg: "bg-blue-100 dark:bg-blue-950/50",       text: "text-blue-700 dark:text-blue-300" },
    partial: { icon: AlertTriangle,  bg: "bg-amber-100 dark:bg-amber-950/50",     text: "text-amber-700 dark:text-amber-300" },
    error:   { icon: AlertCircle,    bg: "bg-red-100 dark:bg-red-950/50",         text: "text-red-700 dark:text-red-300" },
    pending: { icon: Clock,          bg: "bg-zinc-100 dark:bg-zinc-800",          text: "text-zinc-600 dark:text-zinc-300" },
  };
  const { icon: Icon, bg, text } = cfg[status] ?? cfg.pending;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${bg} ${text}`}>
      <Icon className={`h-2.5 w-2.5 ${status === "running" ? "animate-spin" : ""}`} strokeWidth={2.5} />
      {statusLabel(status)}
    </span>
  );
}

export function ExtractionJobHistory({ refreshKey = 0, className }: Props) {
  const { busy, resumeJob, activeJobId } = useExtractionRun();
  const [jobs, setJobs] = useState<ExtractionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [resumingId, setResumingId] = useState<string | null>(null);

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

  async function handleResume(jobId: string) {
    setResumingId(jobId);
    try {
      await resumeJob(jobId);
    } finally {
      setResumingId(null);
    }
  }

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-display text-[14px] font-semibold text-[var(--color-text)]">
            {titleCase("Job History")}
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--color-text-faint)]">
            {titleCase("Recent extraction runs. Resume partial jobs to retry failed batches.")}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="skeleton-shimmer h-11 w-full rounded-lg" />
          <Skeleton className="skeleton-shimmer h-11 w-full rounded-lg" />
        </div>
      ) : jobs.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-[var(--color-text-faint)]">
          {titleCase("No jobs yet. Start an extraction above.")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
          <table className="min-w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-offset)]/60">
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
                  {titleCase("Date")}
                </th>
                <th className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
                  {titleCase("Status")}
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
                  {titleCase("Emails")}
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
                  {titleCase("Cost")}
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
                  {titleCase("Actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {jobs.map((j) => {
                const cost =
                  j.openai_cost_usd != null && Number(j.openai_cost_usd) > 0
                    ? `$${Number(j.openai_cost_usd).toFixed(4)}`
                    : "—";
                const canResume = jobCanResume(j) && j.id !== activeJobId;
                const isResuming = resumingId === j.id;

                return (
                  <tr
                    key={j.id}
                    className="transition-colors duration-100 hover:bg-[var(--color-surface-offset)]/50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-[var(--color-text-muted)]">
                      {formatWhen(j.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={j.status} />
                      {j.error_message && j.status !== "done" ? (
                        <p
                          className="mt-1 max-w-[180px] truncate text-[10px] text-[var(--color-text-faint)]"
                          title={j.error_message}
                        >
                          {j.error_message}
                        </p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">
                      {j.processed_emails}
                      {j.total_emails > 0 ? (
                        <span className="text-[var(--color-text-faint)]"> / {j.total_emails}</span>
                      ) : null}
                      {j.batch_count && j.batch_count > 0 && j.status !== "done" ? (
                        <span className="mt-0.5 block text-[10px] text-[var(--color-text-faint)]">
                          {titleCase(
                            `Batch ${Math.min((j.next_batch_index ?? 0) + 1, j.batch_count)} / ${j.batch_count}`
                          )}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">
                      {cost}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {canResume ? (
                        <button
                          type="button"
                          disabled={busy || isResuming}
                          onClick={() => void handleResume(j.id)}
                          className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-tint)] disabled:opacity-50"
                        >
                          {isResuming ? titleCase("Resuming…") : titleCase("Resume")}
                        </button>
                      ) : j.id === activeJobId && busy ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-primary)]">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          {titleCase("Active")}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--color-text-faint)]">—</span>
                      )}
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

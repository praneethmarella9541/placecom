"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { dataApi } from "@/lib/data-model/client";

type StageStat = { id: string; name: string; color: string | null; is_closed: boolean; target_days: number | null; current: number; avg_days_in_stage: number | null; late: number; reached: number; reached_pct_of_first: number | null };
type Report = { list: { id: string; name: string }; total: number; unstaged: number; stages: StageStat[] };

/** How a pipeline is doing: the funnel (cards that ever reached each stage), who is where now, and who is late. */
export default function ListReportPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void dataApi<Report>(`/api/data/lists/${id}/report`).then((r) => {
      if (!live) return;
      if (r.ok) setReport(r.data);
      else setError(r.status === 404 ? "This list doesn't exist or was archived." : r.error);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const back = (
    <Link href={`/data/lists/${id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
      <ArrowLeft className="h-3.5 w-3.5" /> Board
    </Link>
  );
  if (error) return <div className="mx-auto max-w-[900px] space-y-3">{back}<p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p></div>;
  if (!report) return <div className="flex justify-center py-20 text-[var(--color-text-faint)]"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const maxReached = Math.max(1, ...report.stages.map((s) => s.reached));
  const maxNow = Math.max(1, ...report.stages.map((s) => s.current));

  return (
    <div className="mx-auto max-w-[900px] space-y-6">
      {back}
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{report.list.name} · report</h1>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          {report.total.toLocaleString("en-IN")} cards{report.unstaged ? `, ${report.unstaged} with no stage` : ""}.
        </p>
      </div>

      <section aria-label="Funnel" className="card space-y-3 p-5">
        <div>
          <h2 className="text-[13px] font-semibold">Funnel</h2>
          <p className="text-[12.5px] text-[var(--color-text-muted)]">Cards that have reached each stage, and what share of the first stage that is. Cards that were on the board before stage history began only count for the stage they are in now.</p>
        </div>
        <ul className="space-y-2">
          {report.stages.map((s) => (
            <li key={s.id} className="grid grid-cols-[130px_minmax(0,1fr)_90px] items-center gap-3 text-[13px]">
              <span className="truncate font-medium">{s.name}</span>
              <span className="h-5 overflow-hidden rounded bg-[var(--color-surface-offset)]" aria-hidden>
                <span className="block h-full rounded bg-[var(--color-copper)]" style={{ width: `${(s.reached / maxReached) * 100}%` }} />
              </span>
              <span className="text-right tabular-nums">{s.reached.toLocaleString("en-IN")}{s.reached_pct_of_first !== null ? ` · ${s.reached_pct_of_first}%` : ""}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Right now" className="card overflow-x-auto p-5">
        <h2 className="mb-3 text-[13px] font-semibold">Right now</h2>
        <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="text-[12px] uppercase tracking-wide text-[var(--color-text-faint)]">
              <th scope="col" className="pb-2 font-semibold">Stage</th>
              <th scope="col" className="pb-2 font-semibold">In it now</th>
              <th scope="col" className="pb-2 text-right font-semibold">Average days there</th>
              <th scope="col" className="pb-2 text-right font-semibold">Past target</th>
            </tr>
          </thead>
          <tbody>
            {report.stages.map((s) => (
              <tr key={s.id} className="border-t border-[var(--color-border)]">
                <td className="py-2 font-medium">{s.name}</td>
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-24 overflow-hidden rounded bg-[var(--color-surface-offset)]" aria-hidden>
                      <span className="block h-full bg-[var(--color-text-muted)]" style={{ width: `${(s.current / maxNow) * 100}%` }} />
                    </span>
                    <span className="tabular-nums">{s.current}</span>
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums">{s.avg_days_in_stage ?? "—"}</td>
                <td className={cn("py-2 text-right tabular-nums", s.late > 0 && "font-semibold text-[var(--color-danger)]")}>{s.target_days ? `${s.late} (target ${s.target_days}d)` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

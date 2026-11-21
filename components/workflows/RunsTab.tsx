"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { dataApi } from "@/lib/data-model/client";
import type { Graph, Trigger } from "@/lib/workflows/types";
import { blockTitle, describeTrigger, type WorkflowMeta } from "@/lib/workflows/describe";
import { BlockTree, type StepStatus } from "@/components/workflows/BlockTree";

type RunListItem = { id: string; status: string; record_id: string | null; record_name: string | null; version_no: number | null; attempt_no: number; error: string | null; outcome: string | null; created_at: string; finished_at: string | null; next_run_at: string };
type RunDetail = {
  run: { id: string; workflow_id: string; status: string; record_id: string | null; attempt_no: number; error: string | null; outcome: string | null; created_at: string; started_at: string | null; finished_at: string | null; next_run_at: string; cursor: { blockKey?: string | null } };
  steps: { id: number; block_key: string; block_type: string; attempt: number; status: "succeeded" | "failed" | "stopped"; input: unknown; output: unknown; error: string | null; started_at: string; finished_at: string | null }[];
  version: { version_no: number; graph: Graph; trigger_type: string | null; trigger_config: Record<string, unknown> } | null;
  workflow: { id: string; name: string } | null;
  record: { id: string; name: string } | null;
};

const STATUS_STYLE: Record<string, string> = {
  succeeded: "bg-[var(--color-success-light)] text-[var(--color-success)]",
  failed: "bg-[var(--color-danger-light)] text-[var(--color-danger)]",
  cancelled: "bg-[var(--color-surface-offset)] text-[var(--color-text-muted)]",
  queued: "bg-[var(--color-warning-light)] text-[var(--color-warning)]",
  running: "bg-[var(--color-primary-light)] text-[var(--color-primary)]",
  waiting: "bg-[var(--color-warning-light)] text-[var(--color-warning)]",
};
export const StatusChip = ({ status }: { status: string }) => <span className={cn("inline-block rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold capitalize", STATUS_STYLE[status] ?? "bg-[var(--color-surface-offset)]")}>{status}</span>;

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—");
const duration = (a: string | null, b: string | null) => (a && b ? `${Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000))}s` : "—");

export function RunsTab({ workflowId, meta, initialRunId }: { workflowId: string; meta: WorkflowMeta | null; initialRunId?: string | null }) {
  const [runId, setRunId] = useState<string | null>(initialRunId ?? null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ runs: RunListItem[]; total: number; pageSize: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await dataApi<{ runs: RunListItem[]; total: number; pageSize: number }>(`/api/workflows/${workflowId}/runs?page=${page}${status ? `&status=${status}` : ""}`);
    if (r.ok) {
      setData(r.data);
      setError(null);
    } else setError(r.error);
  }, [workflowId, page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (runId) return <RunViewer runId={runId} meta={meta} workflowId={workflowId} onBack={() => { setRunId(null); void load(); }} />;

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="run-status" className="sr-only">Status</label>
        <select id="run-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input-field select-chevron h-9 w-[170px] text-[12.5px]">
          <option value="">All runs</option>
          {["queued", "running", "waiting", "succeeded", "failed", "cancelled"].map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
        <button type="button" onClick={() => void load()} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]"><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
        <span className="text-[12.5px] text-[var(--color-text-muted)]">{data ? `${data.total.toLocaleString("en-IN")} runs` : ""}</span>
      </div>
      {error && <p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
              <th scope="col" className="px-3 py-2 font-semibold">Started</th>
              <th scope="col" className="px-3 py-2 font-semibold">Status</th>
              <th scope="col" className="px-3 py-2 font-semibold">Record</th>
              <th scope="col" className="px-3 py-2 font-semibold">Took</th>
              <th scope="col" className="px-3 py-2 font-semibold">Version</th>
            </tr>
          </thead>
          <tbody>
            {data === null ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-[var(--color-text-faint)]" /></td></tr>
            ) : data.runs.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-[var(--color-text-muted)]">No runs yet.</td></tr>
            ) : (
              data.runs.map((r) => (
                <tr key={r.id} className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]" onClick={() => setRunId(r.id)}>
                  <td className="px-3 py-2"><button type="button" onClick={() => setRunId(r.id)} className="font-semibold hover:underline">{when(r.created_at)}</button></td>
                  <td className="px-3 py-2"><StatusChip status={r.status} />{r.attempt_no > 1 && <span className="ml-1.5 text-[11.5px] text-[var(--color-text-faint)]">attempt {r.attempt_no}</span>}</td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-[var(--color-text-muted)]">{r.record_name ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums text-[var(--color-text-muted)]">{duration(r.created_at, r.finished_at)}</td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{r.version_no ? `v${r.version_no}` : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12.5px]">
          <span className="text-[var(--color-text-muted)]">Page {page} of {pages}</span>
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost h-8 px-2 disabled:opacity-40">Previous</button>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="btn-ghost h-8 px-2 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}

function RunViewer({ runId, meta, workflowId, onBack }: { runId: string; meta: WorkflowMeta | null; workflowId: string; onBack: () => void }) {
  const [d, setD] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await dataApi<RunDetail>(`/api/workflows/runs/${runId}`);
    if (r.ok) {
      setD(r.data);
      setError(null);
    } else setError(r.error);
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);
  // While a run is still going, keep the picture current.
  const active = d && ["queued", "running", "waiting"].includes(d.run.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [active, load]);

  const statuses = useMemo(() => {
    const out: Record<string, StepStatus> = {};
    if (!d?.version) return out;
    const latest = d.steps.filter((s) => s.attempt === d.run.attempt_no);
    for (const key of Object.keys(d.version.graph.blocks)) out[key] = "pending";
    for (const s of latest) out[s.block_key] = s.status;
    return out;
  }, [d]);

  async function act(path: "retry" | "cancel", body?: unknown) {
    setBusy(true);
    const r = await dataApi(`/api/workflows/runs/${runId}/${path}`, { method: "POST", body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    void load();
  }

  const back = <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><ArrowLeft className="h-3.5 w-3.5" /> All runs</button>;
  if (error && !d) return <div className="space-y-3">{back}<p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p></div>;
  if (!d) return <div className="space-y-3">{back}<Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-faint)]" /></div>;

  const trigger: Trigger = { type: d.version?.trigger_type as Trigger["type"], config: d.version?.trigger_config ?? {} };
  const shownSteps = d.steps.filter((s) => (selected ? s.block_key === selected : false));
  const block = selected && selected !== "trigger" ? d.version?.graph.blocks[selected] : null;
  const canRetry = d.run.status === "failed" || d.run.status === "cancelled";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <div className="flex items-center gap-2">
          {canRetry && (
            <>
              <button type="button" disabled={busy} onClick={() => void act("retry", { from: "start" })} className="btn-ghost h-8 px-3 text-[12.5px]">Retry from the start</button>
              {d.run.cursor?.blockKey && <button type="button" disabled={busy} onClick={() => void act("retry", { from: "failed" })} className="btn-primary-copper h-8 px-3 text-[12.5px]">Retry from the failed block</button>}
            </>
          )}
          {active && <button type="button" disabled={busy} onClick={() => void act("cancel")} className="btn-ghost h-8 px-3 text-[12.5px] text-[var(--color-danger)]">Cancel run</button>}
        </div>
      </div>

      <div className="card space-y-1 p-4 text-[13px]">
        <p className="flex flex-wrap items-center gap-2">
          <StatusChip status={d.run.status} />
          <span className="text-[var(--color-text-muted)]">started {when(d.run.created_at)} · took {duration(d.run.created_at, d.run.finished_at)} · version {d.version ? `v${d.version.version_no}` : "?"}{d.run.attempt_no > 1 ? ` · attempt ${d.run.attempt_no}` : ""}</span>
        </p>
        {d.record && <p>Record: <Link href={`/data/${d.record.id}`} className="font-semibold hover:underline">{d.record.name || "Unnamed"}</Link></p>}
        {d.run.status === "waiting" && <p className="text-[var(--color-text-muted)]">Waiting. Next step at {when(d.run.next_run_at)}.</p>}
        {d.run.outcome && <p className="text-[var(--color-text-muted)]">Ended quietly: {d.run.outcome}</p>}
        {d.run.error && <p role="alert" className="text-[var(--color-danger)]">{d.run.error}</p>}
        {error && <p role="alert" className="text-[var(--color-danger)]">{error}</p>}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="card overflow-x-auto p-4">
          {d.version ? (
            <BlockTree graph={d.version.graph} trigger={trigger} meta={meta} selected={selected} onSelect={setSelected} statuses={statuses} />
          ) : (
            <p className="text-[13px] text-[var(--color-text-muted)]">The version this run used isn&apos;t available.</p>
          )}
        </div>
        <section aria-label="Block details" className="card space-y-3 p-4">
          {!selected ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">Select a block to see what went in and what came out.</p>
          ) : selected === "trigger" ? (
            <>
              <h3 className="text-[14px] font-semibold">Trigger</h3>
              <p className="text-[13px] text-[var(--color-text-muted)]">{describeTrigger(trigger, meta)}</p>
            </>
          ) : (
            <>
              <h3 className="text-[14px] font-semibold">{block ? blockTitle(block) : selected}</h3>
              {shownSteps.length === 0 ? <p className="text-[13px] text-[var(--color-text-muted)]">This block never ran.</p> : shownSteps.map((s) => (
                <div key={s.id} className="space-y-1.5 border-t border-[var(--color-border)] pt-2 first:border-0 first:pt-0">
                  <p className="text-[12px] text-[var(--color-text-faint)]">Attempt {s.attempt} · {s.status} · {when(s.started_at)}</p>
                  {s.error && <p role="alert" className="text-[13px] text-[var(--color-danger)]">{s.error}</p>}
                  <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Settings</p>
                  <pre className="max-h-40 overflow-auto rounded bg-[var(--color-surface-offset)] p-2 text-[11.5px]">{JSON.stringify(s.input, null, 2)}</pre>
                  {s.output !== null && s.output !== undefined && (
                    <>
                      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Result</p>
                      <pre className="max-h-40 overflow-auto rounded bg-[var(--color-surface-offset)] p-2 text-[11.5px]">{JSON.stringify(s.output, null, 2)}</pre>
                    </>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      </div>
      <p className="text-[12px] text-[var(--color-text-faint)]">Workflow {workflowId.slice(0, 8)} · run {runId.slice(0, 8)}</p>
    </div>
  );
}

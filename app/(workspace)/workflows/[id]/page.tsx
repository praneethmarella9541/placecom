"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { dataApi } from "@/lib/data-model/client";
import { RecordPicker } from "@/components/data/AttributeField";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { BlockTree } from "@/components/workflows/BlockTree";
import { BlockPanel, TriggerPanel } from "@/components/workflows/panels";
import { RunsTab } from "@/components/workflows/RunsTab";
import { addBlock, removeBlock, updateBlock, type Slot } from "@/lib/workflows/graph";
import type { WorkflowMeta } from "@/lib/workflows/describe";
import { EMPTY_GRAPH, type BlockType, type Graph, type Trigger } from "@/lib/workflows/types";
import { useMeMailbox } from "@/lib/use-me-mailbox";

type Version = { id: string; version_no: number; graph: Graph; trigger_type: Trigger["type"]; trigger_config: Record<string, unknown> };
type Workflow = { id: string; name: string; description: string | null; owner_id: string | null; status: "draft" | "live" | "off"; live_version_id: string | null; flagged_at: string | null; flag_reason: string | null };

const SAVE_DELAY_MS = 700;
const snapshot = (graph: Graph, trigger: Trigger) => JSON.stringify({ graph, trigger });

export default function WorkflowEditorPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const { me } = useMeMailbox();
  const [wf, setWf] = useState<Workflow | null>(null);
  const [live, setLive] = useState<Version | null>(null);
  const [graph, setGraph] = useState<Graph>(EMPTY_GRAPH);
  const [trigger, setTrigger] = useState<Trigger>({ type: null, config: {} });
  const [meta, setMeta] = useState<WorkflowMeta | null>(null);
  const [selected, setSelected] = useState<string | "trigger" | null>("trigger");
  const [tab, setTab] = useState<"builder" | "runs">("builder");
  const [initialRun, setInitialRun] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [runRecord, setRunRecord] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const lastSaved = useRef<string>("");
  const ready = useRef(false);

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([
      dataApi<{ workflow: Workflow; draft: Version | null; live: Version | null }>(`/api/workflows/${id}`),
      dataApi<WorkflowMeta>("/api/workflows/meta"),
    ]);
    if (!r.ok) return setLoadError(r.status === 404 ? "This workflow doesn't exist or was deleted." : r.status === 403 ? "Only admins can use workflows." : r.error);
    if (m.ok) setMeta(m.data);
    setWf(r.data.workflow);
    setName(r.data.workflow.name);
    setLive(r.data.live);
    const g = r.data.draft?.graph ?? EMPTY_GRAPH;
    const t: Trigger = { type: r.data.draft?.trigger_type ?? null, config: r.data.draft?.trigger_config ?? {} };
    setGraph(g);
    setTrigger(t);
    lastSaved.current = snapshot(g, t);
    ready.current = true;
  }, [id]);

  useEffect(() => {
    void load();
    const run = new URLSearchParams(window.location.search).get("run");
    if (run) {
      setInitialRun(run);
      setTab("runs");
    }
  }, [load]);

  // Save the working draft shortly after the last change. Nothing live changes until Publish.
  const save = useCallback(async (): Promise<boolean> => {
    const snap = snapshot(graph, trigger);
    if (snap === lastSaved.current) return true;
    setSaveState("saving");
    const r = await dataApi(`/api/workflows/${id}`, { method: "PATCH", body: { graph, trigger } });
    if (!r.ok) {
      setSaveState("error");
      setProblems([r.error]);
      return false;
    }
    lastSaved.current = snap;
    setSaveState("saved");
    // The change that caused an earlier problem is fixed; don't leave the old message up.
    setProblems([]);
    return true;
  }, [graph, trigger, id]);

  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => void save(), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [graph, trigger, save]);

  // Warn about leaving with an unsaved draft.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (ready.current && snapshot(graph, trigger) !== lastSaved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [graph, trigger]);

  const unpublished = useMemo(() => !live || snapshot(live.graph, { type: live.trigger_type, config: live.trigger_config }) !== snapshot(graph, trigger), [live, graph, trigger]);

  async function patch(body: Record<string, unknown>, what: string) {
    setBusy(what);
    setProblems([]);
    const r = await dataApi<{ workflow: Workflow }>(`/api/workflows/${id}`, { method: "PATCH", body });
    setBusy(null);
    if (!r.ok) return setProblems([r.error]);
    setWf(r.data.workflow);
  }

  async function publish() {
    setBusy("publish");
    setProblems([]);
    setNotice(null);
    if (!(await save())) return setBusy(null);
    const r = await dataApi<{ version: number }>(`/api/workflows/${id}/publish`, { method: "POST" });
    setBusy(null);
    if (!r.ok) return setProblems(r.errors?.length ? r.errors : [r.error]);
    setNotice(`Published as version ${r.data.version}. It is live.`);
    void load();
  }

  async function runNow() {
    setBusy("run");
    setProblems([]);
    const r = await dataApi<{ runId: string }>(`/api/workflows/${id}/run`, { method: "POST", body: { recordId: runRecord } });
    setBusy(null);
    if (!r.ok) return setProblems([r.error]);
    setRunRecord("");
    setInitialRun(r.data.runId);
    setTab("runs");
  }

  async function remove() {
    setBusy("delete");
    const r = await dataApi(`/api/workflows/${id}`, { method: "DELETE" });
    setBusy(null);
    setConfirmDelete(false);
    if (!r.ok) return setProblems([r.error]);
    window.location.href = "/workflows";
  }

  const back = (
    <Link href="/workflows" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]"><ArrowLeft className="h-3.5 w-3.5" /> Workflows</Link>
  );
  if (loadError) return <div className="mx-auto max-w-[900px] space-y-3">{back}<p role="alert" className="text-[13px] text-[var(--color-danger)]">{loadError}</p></div>;
  if (!wf) return <div className="flex justify-center py-20 text-[var(--color-text-faint)]"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  const block = selected && selected !== "trigger" ? graph.blocks[selected] : null;
  const isManualLive = wf.status === "live" && live?.trigger_type === "manual";
  const manualObject = (live?.trigger_config.object as string | undefined) ?? "people";
  const tabCls = (on: boolean) => cn("-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold", on ? "border-[var(--color-copper)] text-[var(--color-text)]" : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]");

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {back}
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-faint)]" aria-live="polite">
          {saveState === "saving" ? <><Loader2 className="h-3 w-3 animate-spin" /> Saving draft…</> : saveState === "saved" ? <><Check className="h-3 w-3" /> Draft saved</> : saveState === "error" ? "Couldn't save the draft" : null}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[240px] flex-1">
          <input
            aria-label="Workflow name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== wf.name && void patch({ name }, "name")}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-2xl font-bold tracking-tight hover:border-[var(--color-border)] focus:border-[var(--color-border-strong)] focus:outline-none"
          />
          <p className="px-2 text-[12.5px] text-[var(--color-text-muted)]">
            {wf.status === "live" ? <span className="font-semibold text-[var(--color-success)]">On</span> : wf.status === "off" ? "Off" : "Draft, never published"}
            {live ? ` · live version ${live.version_no}` : ""}{unpublished && live ? " · you have changes that aren't published" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {wf.status === "live" && <button type="button" disabled={busy !== null} onClick={() => void patch({ status: "off" }, "off")} className="btn-ghost h-9 px-3 text-[12.5px]">Turn off</button>}
          {wf.status === "off" && wf.live_version_id && <button type="button" disabled={busy !== null} onClick={() => void patch({ status: "live" }, "live")} className="btn-ghost h-9 px-3 text-[12.5px]">Turn on</button>}
          <button type="button" disabled={busy !== null || !unpublished} onClick={() => void publish()} className="btn-primary-copper inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px] disabled:opacity-50">
            {busy === "publish" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {live ? "Publish changes" : "Publish"}
          </button>
          {me?.allowDelete && <button type="button" onClick={() => setConfirmDelete(true)} className="btn-ghost h-9 px-3 text-[12.5px] text-[var(--color-danger)]">Delete</button>}
        </div>
      </div>

      {wf.flag_reason && <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">{wf.flag_reason}</p>}
      {notice && <p role="status" className="rounded-lg bg-[var(--color-success-light)] px-3 py-2 text-[12.5px] text-[var(--color-success)]">{notice}</p>}
      {problems.length > 0 && (
        <div role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
          <p className="font-semibold">{problems.length > 1 ? "Fix these before publishing:" : "Couldn't do that:"}</p>
          <ul className="list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      {isManualLive && (
        <div className="card flex flex-wrap items-end gap-3 p-3">
          <div className="min-w-[240px] flex-1">
            <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Run now on a {manualObject} record</p>
            <RecordPicker targetObject={manualObject} value={runRecord} onChange={setRunRecord} />
          </div>
          <button type="button" disabled={!runRecord || busy !== null} onClick={() => void runNow()} className="btn-primary-copper inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]">{busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run</button>
        </div>
      )}

      <div role="tablist" aria-label="Workflow" className="flex border-b border-[var(--color-border)]">
        <button type="button" role="tab" aria-selected={tab === "builder"} onClick={() => setTab("builder")} className={tabCls(tab === "builder")}>Builder</button>
        <button type="button" role="tab" aria-selected={tab === "runs"} onClick={() => setTab("runs")} className={tabCls(tab === "runs")}>Runs</button>
      </div>

      {tab === "runs" ? (
        <RunsTab workflowId={id} meta={meta} initialRunId={initialRun} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="card overflow-x-auto p-4" style={{ minHeight: 360 }}>
            <BlockTree
              graph={graph}
              trigger={trigger}
              meta={meta}
              selected={selected}
              onSelect={setSelected}
              onAdd={(at: Slot, type: BlockType) => {
                const r = addBlock(graph, at, type);
                setGraph(r.graph);
                setSelected(r.key);
              }}
            />
          </div>
          <section aria-label="Settings" className="card p-4 lg:sticky lg:top-4">
            {selected === "trigger" || !selected ? (
              <TriggerPanel trigger={trigger} meta={meta} onChange={setTrigger} />
            ) : block ? (
              <BlockPanel
                key={block.key}
                block={block}
                graph={graph}
                trigger={trigger}
                meta={meta}
                onConfig={(config) => setGraph((g) => updateBlock(g, block.key, { config }))}
                onLabel={(label) => setGraph((g) => updateBlock(g, block.key, { label }))}
                onRemove={() => {
                  setGraph((g) => removeBlock(g, block.key));
                  setSelected("trigger");
                }}
              />
            ) : (
              <p className="text-[13px] text-[var(--color-text-muted)]">Select the trigger or a block to edit it.</p>
            )}
          </section>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${wf.name}"?`}
          body="It stops and is removed from the list. Its past runs stay readable."
          confirmLabel="Delete"
          tone="danger"
          busy={busy === "delete"}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

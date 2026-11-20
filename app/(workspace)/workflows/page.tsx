"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Loader2, Plus } from "lucide-react";
import { dataApi } from "@/lib/data-model/client";
import { TRIGGER_LABELS } from "@/lib/workflows/describe";
import type { TriggerType } from "@/lib/workflows/types";
import { StatusChip } from "@/components/workflows/RunsTab";

type Item = { id: string; name: string; status: "draft" | "live" | "off"; published: boolean; trigger_type: TriggerType | null; flagged_at: string | null; flag_reason: string | null; last_run_status: string | null; runs_7d: number; failed_7d: number; updated_at: string };
type Note = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

const STATE_LABEL: Record<Item["status"], string> = { draft: "Draft", live: "On", off: "Off" };

export default function WorkflowsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [w, n] = await Promise.all([dataApi<{ workflows: Item[] }>("/api/workflows"), dataApi<{ notifications: Note[] }>("/api/workflows/notifications")]);
    if (w.ok) {
      setItems(w.data.workflows);
      setError(null);
    } else setError(w.status === 403 ? "Only admins can use workflows." : w.error);
    if (n.ok) setNotes(n.data.notifications);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    const r = await dataApi<{ workflow: { id: string } }>("/api/workflows", { method: "POST", body: { name } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/workflows/${r.data.workflow.id}`);
  }

  async function markAllRead() {
    await dataApi("/api/workflows/notifications", { method: "POST", body: { all: true } });
    void load();
  }

  const unread = notes.filter((n) => !n.read_at).length;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">Workflows</h1>
        <button type="button" onClick={() => setCreating((c) => !c)} className="btn-primary-copper inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]"><Plus className="h-3.5 w-3.5" /> New workflow</button>
      </div>
      <p className="max-w-[70ch] text-[13px] text-[var(--color-text-muted)]">When something happens in your data, check a condition, then act. Each workflow is a trigger followed by blocks. Every run is recorded so you can see why something did or didn&apos;t happen.</p>

      {creating && (
        <form
          className="card flex flex-wrap items-end gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="min-w-[240px] flex-1">
            <label htmlFor="wf-name" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Name</label>
            <input id="wf-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="New lead gets a follow-up task" className="input-field h-9 text-[13px]" />
          </div>
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary-copper inline-flex h-9 items-center gap-2 px-3 text-[12.5px]">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create</button>
        </form>
      )}

      {error && <p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p>}

      {items === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-text-faint)]" />
      ) : items.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)]">No workflows yet.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
                <th scope="col" className="px-3 py-2 font-semibold">Name</th>
                <th scope="col" className="px-3 py-2 font-semibold">State</th>
                <th scope="col" className="px-3 py-2 font-semibold">Starts when</th>
                <th scope="col" className="px-3 py-2 font-semibold">Last run</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Runs (7 days)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr key={w.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                  <td className="px-3 py-2">
                    <Link href={`/workflows/${w.id}`} className="font-semibold hover:underline">{w.name}</Link>
                    {w.flag_reason && <p className="mt-0.5 max-w-[420px] text-[12px] text-[var(--color-danger)]">{w.flag_reason}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={w.status === "live" ? "font-semibold text-[var(--color-success)]" : "text-[var(--color-text-muted)]"}>{STATE_LABEL[w.status]}</span>
                    {w.status !== "draft" && !w.published ? "" : null}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-text-muted)]">{w.trigger_type ? TRIGGER_LABELS[w.trigger_type] : "Not set"}</td>
                  <td className="px-3 py-2">{w.last_run_status ? <StatusChip status={w.last_run_status} /> : <span className="text-[var(--color-text-faint)]">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{w.runs_7d}{w.failed_7d > 0 && <span className="ml-1.5 text-[var(--color-danger)]">({w.failed_7d} failed)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notes.length > 0 && (
        <section aria-label="Notifications" className="card space-y-2 p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold"><Bell className="h-3.5 w-3.5" /> Notifications{unread > 0 && <span className="rounded-full bg-[var(--color-copper)] px-1.5 text-[11px] text-white">{unread}</span>}</h2>
            {unread > 0 && <button type="button" onClick={() => void markAllRead()} className="text-[12.5px] font-semibold text-[var(--color-text-muted)] underline">Mark all read</button>}
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {notes.slice(0, 15).map((n) => (
              <li key={n.id} className="py-2 text-[13px]">
                <p className={n.read_at ? "text-[var(--color-text-muted)]" : "font-semibold"}>
                  {n.link ? <Link href={n.link} onClick={() => void dataApi("/api/workflows/notifications", { method: "POST", body: { id: n.id } })} className="hover:underline">{n.title}</Link> : n.title}
                </p>
                {n.body && <p className="text-[12.5px] text-[var(--color-text-muted)]">{n.body}</p>}
                <p className="text-[11.5px] text-[var(--color-text-faint)]">{new Date(n.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

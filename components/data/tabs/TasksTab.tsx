"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { dataApi } from "@/lib/data-model/client";

type Task = { id: string; title: string; due_date: string | null; assignee_id: string | null; assignee_name: string | null; done_at: string | null; created_by: string | null };
type Member = { id: string; name: string };

const today = () => new Date().toISOString().slice(0, 10);

/** To-dos on a record: due date, optional assignee, tick to finish. */
export function TasksTab({ recordId, canWrite, isAdmin, userId }: { recordId: string; canWrite: boolean; isAdmin: boolean; userId?: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await dataApi<{ tasks: Task[] }>(`/api/data/records/${recordId}/tasks`);
    if (r.ok) setTasks(r.data.tasks);
    else setError(r.error);
  }, [recordId]);

  useEffect(() => {
    void load();
    void dataApi<{ members: Member[] }>("/api/data/members").then((r) => r.ok && setMembers(r.data.members));
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await dataApi(`/api/data/records/${recordId}/tasks`, { method: "POST", body: { title, dueDate: due || undefined, assigneeId: assignee || undefined } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setTitle("");
    setDue("");
    void load();
  }

  async function toggle(t: Task) {
    const r = await dataApi(`/api/data/tasks/${t.id}`, { method: "PATCH", body: { done: !t.done_at } });
    if (!r.ok) return setError(r.error);
    void load();
  }

  async function remove(id: string) {
    const r = await dataApi(`/api/data/tasks/${id}`, { method: "DELETE" });
    if (!r.ok) return setError(r.error);
    setTasks((ts) => (ts ?? []).filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) void add();
          }}
        >
          <div className="min-w-[200px] flex-1">
            <label htmlFor="new-task" className="sr-only">Task</label>
            <input id="new-task" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" maxLength={300} className="input-field h-9 text-[13px]" />
          </div>
          <input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input-field h-9 w-[150px] text-[13px]" />
          <select aria-label="Assign to" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input-field select-chevron h-9 w-[160px] text-[13px]">
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <button type="submit" disabled={busy || !title.trim()} className="btn-primary-copper inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Add
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-[12.5px] text-[var(--color-danger)]">{error}</p>}
      {tasks === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-faint)]" />
      ) : tasks.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)]">No tasks.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {tasks.map((t) => {
            const overdue = !t.done_at && t.due_date !== null && t.due_date < today();
            return (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <input type="checkbox" aria-label={`Mark "${t.title}" ${t.done_at ? "not done" : "done"}`} checked={!!t.done_at} disabled={!canWrite} onChange={() => void toggle(t)} />
                <span className={cn("min-w-0 flex-1 truncate", t.done_at && "text-[var(--color-text-faint)] line-through")}>{t.title}</span>
                {t.assignee_name && <span className="text-[12px] text-[var(--color-text-muted)]">{t.assignee_name}</span>}
                {t.due_date && (
                  <span className={cn("text-[12px]", overdue ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-text-muted)]")}>
                    {overdue ? "Overdue · " : ""}
                    {new Date(`${t.due_date}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short" })}
                  </span>
                )}
                {canWrite && (isAdmin || t.created_by === userId) && (
                  <button type="button" aria-label="Delete task" onClick={() => void remove(t.id)} className="text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

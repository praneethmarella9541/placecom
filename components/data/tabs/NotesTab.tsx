"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { dataApi } from "@/lib/data-model/client";

type Note = { id: string; kind: "note" | "call" | "email" | "meeting"; body: string; author: string; mine: boolean; created_at: string };
const KIND_LABELS: Record<Note["kind"], string> = { note: "Note", call: "Call", email: "Email", meeting: "Meeting" };

/** Free-text notes, and calls, emails or meetings logged by hand, newest first. */
export function NotesTab({ recordId, canWrite, isAdmin }: { recordId: string; canWrite: boolean; isAdmin: boolean }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<Note["kind"]>("note");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await dataApi<{ notes: Note[] }>(`/api/data/records/${recordId}/notes`);
    if (r.ok) setNotes(r.data.notes);
    else setError(r.error);
  }, [recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await dataApi<{ note: Note }>(`/api/data/records/${recordId}/notes`, { method: "POST", body: { body, kind } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setNotes((n) => [r.data.note, ...(n ?? [])]);
    setBody("");
  }

  async function remove(id: string) {
    const r = await dataApi(`/api/data/notes/${id}`, { method: "DELETE" });
    if (!r.ok) return setError(r.error);
    setNotes((n) => (n ?? []).filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) void add();
          }}
        >
          <label htmlFor="new-note" className="sr-only">Add a note</label>
          <textarea id="new-note" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a note, or log a call, email or meeting…" maxLength={10000} className="input-field !h-auto py-2 text-[13px]" />
          <div className="flex items-center gap-2">
            <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as Note["kind"])} className="input-field select-chevron h-8 w-[130px] text-[12.5px]">
              {(Object.keys(KIND_LABELS) as Note["kind"][]).map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>
            <button type="submit" disabled={busy || !body.trim()} className="btn-primary-copper inline-flex h-8 items-center gap-1.5 px-3 text-[12.5px]">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-[12.5px] text-[var(--color-danger)]">{error}</p>}
      {notes === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-faint)]" />
      ) : notes.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)]">No notes yet.</p>
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-[12px] text-[var(--color-text-faint)]">
                <span>
                  <span className="font-semibold text-[var(--color-text-muted)]">{n.author}</span> · {KIND_LABELS[n.kind]} ·{" "}
                  {new Date(n.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}
                </span>
                {canWrite && (n.mine || isAdmin) && (
                  <button type="button" aria-label="Delete note" onClick={() => void remove(n.id)} className="hover:text-[var(--color-danger)]">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words text-[13px]">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

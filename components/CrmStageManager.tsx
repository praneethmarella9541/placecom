"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { IconX } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";
import type { CrmStage } from "@/lib/crm-stages-types";

/**
 * Stage (kanban column) CRUD. The description field is not decoration — it is
 * handed to the classifier as the definition of the category, so the form
 * leans on it rather than treating it as an optional note.
 */
export function CrmStageManager({
  stages,
  onClose,
  onChanged,
}: {
  stages: CrmStage[];
  onClose: () => void;
  onChanged: (stages: CrmStage[]) => void;
}) {
  const [rows, setRows] = useState<CrmStage[]>(stages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  async function call(input: RequestInfo, init?: RequestInit) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(input, init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Request failed");
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const json = await call("/api/crm/stages");
    if (json?.stages) {
      setRows(json.stages);
      onChanged(json.stages);
    }
  }

  async function addStage(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const json = await call("/api/crm/stages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, description: newDescription }),
    });
    if (json) {
      setNewName("");
      setNewDescription("");
      await refresh();
    }
  }

  async function saveField(id: string, patch: Partial<Pick<CrmStage, "name" | "description">>) {
    const json = await call(`/api/crm/stages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (json) await refresh();
  }

  async function remove(stage: CrmStage) {
    if (
      !window.confirm(
        `Delete "${stage.name}"? Any leads in it move to the unsorted column — they aren't deleted.`
      )
    ) {
      return;
    }
    const json = await call(`/api/crm/stages/${stage.id}`, { method: "DELETE" });
    if (json) await refresh();
  }

  async function move(index: number, delta: number) {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setRows(next);
    const json = await call("/api/crm/stages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: next.map((s) => s.id) }),
    });
    if (json?.stages) {
      setRows(json.stages);
      onChanged(json.stages);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-stages-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <h2 id="crm-stages-title" className="font-display text-lg font-bold text-[var(--color-text)]">
              {titleCase("Board columns")}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              Each column&apos;s description tells the classifier what belongs there — write it as
              &ldquo;what puts a lead in this column&rdquo;, not just a label.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost -mr-1.5 -mt-0.5 shrink-0 p-1.5"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4">
          {rows.map((stage, i) => (
            <div
              key={stage.id}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)]/40 p-3.5"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: stage.color ?? "var(--color-text-faint)" }}
                />
                <input
                  defaultValue={stage.name}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== stage.name) void saveField(stage.id, { name: v });
                  }}
                  className="input-field h-8 flex-1 text-[13px] font-semibold"
                  aria-label={`${stage.name} name`}
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    disabled={busy || i === 0}
                    onClick={() => void move(i, -1)}
                    className="btn-ghost h-8 w-8 justify-center p-0 disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy || i === rows.length - 1}
                    onClick={() => void move(i, 1)}
                    className="btn-ghost h-8 w-8 justify-center p-0 disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy || stage.is_unsorted}
                    onClick={() => void remove(stage)}
                    title={
                      stage.is_unsorted
                        ? "The unsorted column can't be deleted"
                        : "Delete this column"
                    }
                    className="btn-ghost h-8 w-8 justify-center p-0 text-[var(--color-danger)] disabled:opacity-30"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <textarea
                defaultValue={stage.description ?? ""}
                rows={2}
                placeholder="What puts a lead in this column?"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== (stage.description ?? "")) void saveField(stage.id, { description: v });
                }}
                className="input-field mt-2 h-auto w-full resize-none py-2 text-[12.5px]"
                aria-label={`${stage.name} description`}
              />
            </div>
          ))}

          <form
            onSubmit={addStage}
            className="rounded-xl border border-dashed border-[var(--color-border-strong)] p-3.5"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={titleCase("New column name")}
              className="input-field h-8 w-full text-[13px] font-semibold"
            />
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={2}
              placeholder="What puts a lead in this column?"
              className="input-field mt-2 h-auto w-full resize-none py-2 text-[12.5px]"
            />
            <button
              type="submit"
              disabled={busy || !newName.trim()}
              className="btn-secondary mt-2 h-8 gap-1.5 px-3 text-[12.5px]"
            >
              <Plus className="h-3.5 w-3.5" />
              {titleCase("Add column")}
            </button>
          </form>

          {error && (
            <p className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-[var(--color-border)] px-6 py-3.5">
          <button type="button" className="btn-primary-copper px-4" onClick={onClose}>
            {titleCase("Done")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

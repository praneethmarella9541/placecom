"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { labelDisplayName, type LabelLike } from "@/components/LabelChip";

type Label = LabelLike & {
  id: string;
  name: string;
  type?: "system" | "user";
  surfaced?: boolean;
};

/**
 * Gmail-style "Labels" dropdown: a search box + a checklist of all
 * surfaced labels + a "Create new" affordance. Used from the thread
 * detail view to add/remove labels on the current thread.
 */
export function LabelPicker({
  allLabels,
  selected,
  onToggle,
  onCreate,
  busy = false,
  align = "right",
}: {
  allLabels: Label[];
  selected: Set<string>;
  onToggle: (labelId: string, nextChecked: boolean) => void;
  onCreate: (name: string) => Promise<void> | void;
  busy?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside close
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const surfaced = allLabels.filter((l) => l.surfaced !== false);
    if (!q) return surfaced;
    return surfaced.filter((l) => labelDisplayName(l).toLowerCase().includes(q));
  }, [allLabels, query]);

  const showCreate =
    query.trim().length > 0 &&
    !allLabels.some(
      (l) => l.type === "user" && l.name.toLowerCase() === query.trim().toLowerCase()
    );

  async function handleCreate() {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await onCreate(name);
      setQuery("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-offset)] disabled:opacity-50"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20.59 13.41 13.41 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
        Labels
      </button>
      {open && (
        <div
          className={`absolute z-30 mt-1 w-64 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="border-b border-[var(--color-border)] p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Label as…"
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-[var(--color-text-muted)]">
                No matching labels.
              </p>
            )}
            {filtered.map((l) => {
              const checked = selected.has(l.id);
              return (
                <label
                  key={l.id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-[var(--color-surface-offset)]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(e) => onToggle(l.id, e.target.checked)}
                  />
                  <span className="truncate text-[var(--color-text)]">{labelDisplayName(l)}</span>
                  {l.type === "system" && (
                    <span className="ml-auto text-[10px] uppercase text-[var(--color-text-faint)]">
                      System
                    </span>
                  )}
                </label>
              );
            })}
          </div>
          {showCreate && (
            <div className="border-t border-[var(--color-border)]">
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={creating}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[var(--color-primary)] hover:bg-[var(--color-surface-offset)] disabled:opacity-50"
              >
                {creating ? "Creating…" : `+ Create label "${query.trim()}"`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

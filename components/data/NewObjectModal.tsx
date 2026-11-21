"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { dataApi } from "@/lib/data-model/client";

/** Admin: create a custom object, for example Colleges. It starts with a name only; fields come after. */
export function NewObjectModal({ onCreated, onClose }: { onCreated: (slug: string) => void; onClose: () => void }) {
  const [singular, setSingular] = useState("");
  const [plural, setPlural] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const r = await dataApi<{ object: { slug: string } }>("/api/data/objects", {
      method: "POST",
      body: { singularName: singular, pluralName: plural },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onCreated(r.data.object.slug);
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-label="New object"
        className="card w-full max-w-[420px] shadow-[var(--shadow-lg)]"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold">New object</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-[12.5px] text-[var(--color-text-muted)]">
            An object is a kind of record you keep, like Colleges or Programs. You add its fields after creating it.
          </p>
          <div>
            <label htmlFor="obj-one" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Called (one)</label>
            <input id="obj-one" autoFocus value={singular} onChange={(e) => setSingular(e.target.value)} placeholder="College" maxLength={40} className="input-field h-9 text-[13px]" />
          </div>
          <div>
            <label htmlFor="obj-many" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Called (many)</label>
            <input id="obj-many" value={plural} onChange={(e) => setPlural(e.target.value)} placeholder="Colleges" maxLength={40} className="input-field h-9 text-[13px]" />
          </div>
          {error && <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || !singular.trim() || !plural.trim()} className="btn-primary-copper inline-flex items-center gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

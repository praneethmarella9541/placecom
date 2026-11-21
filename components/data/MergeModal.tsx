"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { dataApi } from "@/lib/data-model/client";
import { RecordPicker } from "@/components/data/AttributeField";

/**
 * Merge this record with another of the same kind. The one you keep wins every clash; emails,
 * phones and domains are combined; lists, notes, tasks and links all move to it; the other is removed.
 */
export function MergeModal({
  recordId,
  recordName,
  objectSlug,
  singular,
  onMerged,
  onClose,
}: {
  recordId: string;
  recordName: string;
  objectSlug: string;
  singular: string;
  onMerged: (winnerId: string) => void;
  onClose: () => void;
}) {
  const [otherId, setOtherId] = useState("");
  const [otherName, setOtherName] = useState("");
  const [keep, setKeep] = useState<"this" | "other">("this");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    setBusy(true);
    setError(null);
    const winnerId = keep === "this" ? recordId : otherId;
    const loserId = keep === "this" ? otherId : recordId;
    const r = await dataApi("/api/data/merge", { method: "POST", body: { winnerId, loserId } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onMerged(winnerId);
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
      <div role="dialog" aria-label={`Merge ${singular}`} className="card w-full max-w-[480px] shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold">Merge {singular}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4 text-[13px]">
          <div>
            <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Merge with</p>
            <RecordPicker
              targetObject={objectSlug}
              value={otherId}
              onChange={(id) => {
                setOtherId(id);
                if (!id) setOtherName("");
              }}
              onChosen={(r) => setOtherName(r?.name ?? "")}
            />
          </div>
          {otherId && otherId !== recordId && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">When details differ, keep</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="keep" checked={keep === "this"} onChange={() => setKeep("this")} /> {recordName || "This record"} (this one)
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="keep" checked={keep === "other"} onChange={() => setKeep("other")} /> {otherName || "The other record"}
              </label>
              <p className="text-[12px] text-[var(--color-text-muted)]">
                Everything else is combined into the one you keep: emails and phones, lists, notes, tasks and links. The other {singular} is removed. This can&apos;t be undone from the app.
              </p>
            </fieldset>
          )}
          {otherId === recordId && <p role="alert" className="text-[12.5px] text-[var(--color-danger)]">Pick a different {singular}.</p>}
          {error && <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">Cancel</button>
          <button type="button" disabled={busy || !otherId || otherId === recordId} onClick={() => void merge()} className="btn-primary-copper inline-flex items-center gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Merge
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

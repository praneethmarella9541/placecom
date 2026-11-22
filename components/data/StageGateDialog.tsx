"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import type { AttributeDef } from "@/lib/data-model/types";
import { dataApi } from "@/lib/data-model/client";
import { AttributeField, toInput, toPayload, type FieldInput } from "@/components/data/AttributeField";

/**
 * Shown when a stage-gate rule blocks a card's move: instead of just reverting the card with an
 * error, this asks for exactly the fields that were missing, saves them to the RECORD (not the
 * list entry — a stage rule reads the record's own fields), and tells the caller to retry the move.
 */
export function StageGateDialog({
  title,
  recordId,
  attrs,
  missingFields,
  values,
  onClose,
  onFilled,
}: {
  title: string;
  recordId: string;
  attrs: AttributeDef[];
  missingFields: string[];
  values: Record<string, unknown>;
  onClose: () => void;
  onFilled: () => void;
}) {
  const fields = missingFields.map((slug) => attrs.find((a) => a.slug === slug)).filter((a): a is AttributeDef => !!a);
  const [form, setForm] = useState<Record<string, FieldInput>>(() => Object.fromEntries(fields.map((a) => [a.slug, toInput(a, values[a.slug])])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const payload = Object.fromEntries(fields.map((a) => [a.slug, toPayload(a, form[a.slug] ?? "")]));
    const r = await dataApi(`/api/data/records/${recordId}`, { method: "PATCH", body: { values: payload } });
    setBusy(false);
    if (!r.ok) return setError(r.errors?.length ? r.errors.join(" ") : r.error);
    onFilled();
  }

  if (typeof document === "undefined") return null;
  const lbl = "mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]";

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="Fill in the missing fields" className="card flex max-h-[90vh] w-full max-w-[440px] flex-col shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold">Moving to {title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X className="h-4 w-4" /></button>
        </div>
        <form
          className="space-y-3 overflow-y-auto px-5 py-4 text-[13px]"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <p className="text-[12.5px] text-[var(--color-text-muted)]">This stage needs a few more fields before this record can move here.</p>
          {fields.length === 0 ? (
            <p className="text-[12.5px] text-[var(--color-danger)]">Those fields aren&apos;t on this record&apos;s form — ask an admin to check the rule.</p>
          ) : (
            fields.map((a) => (
              <div key={a.slug}>
                <label htmlFor={`gate-${a.slug}`} className={lbl}>{a.name}</label>
                <AttributeField attr={a} idPrefix="gate" value={form[a.slug] ?? ""} onChange={(v) => setForm((f) => ({ ...f, [a.slug]: v }))} />
              </div>
            ))
          )}
          {error && <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">{error}</p>}
          <button type="submit" disabled={busy || fields.length === 0} className="btn-primary-copper inline-flex items-center gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save and move
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}

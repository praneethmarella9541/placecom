"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import type { RecordRow } from "@/lib/data-model/types";
import { dataApi, type ObjectWithAttributes } from "@/lib/data-model/client";
import { AttributeField, toPayload, type FieldInput } from "@/components/data/AttributeField";

export function NewRecordModal({
  object,
  onCreated,
  onClose,
}: {
  object: ObjectWithAttributes;
  onCreated: (record: RecordRow) => void;
  onClose: () => void;
}) {
  const attrs = object.attributes.filter((a) => !a.archived_at);
  const [name, setName] = useState("");
  const [form, setForm] = useState<Record<string, FieldInput>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [existingId, setExistingId] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErrors([]);
    setExistingId(null);
    const values: Record<string, unknown> = {};
    for (const a of attrs) {
      const payload = toPayload(a, form[a.slug] ?? (a.type === "checkbox" ? false : ""));
      if (payload !== null) values[a.slug] = payload;
    }
    const r = await dataApi<{ record: RecordRow }>("/api/data/records", {
      method: "POST",
      body: { object: object.slug, name, values },
    });
    setBusy(false);
    if (r.ok) return onCreated(r.data.record);
    setErrors(r.errors?.length ? r.errors : [r.error]);
    if (r.existingId) setExistingId(r.existingId);
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
        aria-label={`New ${object.singular_name.toLowerCase()}`}
        className="card flex max-h-[90vh] w-full max-w-[520px] flex-col shadow-[var(--shadow-lg)]"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold">New {object.singular_name.toLowerCase()}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div>
            <label htmlFor="new-record-name" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
              Name *
            </label>
            <input id="new-record-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className="input-field h-9 text-[13px]" />
          </div>
          {attrs.map((a) => (
            <AttributeField
              key={a.slug}
              attr={a}
              value={form[a.slug] ?? (a.type === "checkbox" ? false : "")}
              onChange={(v) => setForm((f) => ({ ...f, [a.slug]: v }))}
            />
          ))}
          {errors.length > 0 && (
            <div role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
              {errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
              {existingId && (
                <Link href={`/data/${existingId}`} className="mt-1 inline-block font-semibold underline">
                  Open the existing record
                </Link>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary-copper inline-flex items-center gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

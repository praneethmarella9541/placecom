"use client";

import { useEffect, useRef, useState } from "react";
import type { AttributeDef, RecordRow } from "@/lib/data-model/types";
import { dataApi } from "@/lib/data-model/client";
import { AttributeField, samePayload, toInput, toPayload, type FieldInput } from "@/components/data/AttributeField";

/**
 * Edit one table cell in place. Enter or leaving the cell saves, Escape cancels. A refused value
 * stays open with the reason underneath, so nothing typed is lost.
 */
export function CellEditor({ attr, rec, onCancel, onSaved }: { attr: AttributeDef; rec: RecordRow; onCancel: () => void; onSaved: (record: RecordRow) => void }) {
  const [draft, setDraft] = useState<FieldInput>(() => toInput(attr, rec.values[attr.slug]));
  const draftRef = useRef(draft);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input:not([type=checkbox]), select, textarea")?.focus();
  }, []);

  async function commit() {
    if (done.current || busy) return;
    const payload = toPayload(attr, draftRef.current);
    if (samePayload(payload, rec.values[attr.slug])) {
      done.current = true;
      return onCancel();
    }
    setBusy(true);
    const r = await dataApi<{ record: RecordRow }>(`/api/data/records/${rec.id}`, { method: "PATCH", body: { values: { [attr.slug]: payload } } });
    setBusy(false);
    if (!r.ok) return setError(r.errors?.length ? r.errors.join(" ") : r.error);
    done.current = true;
    onSaved(r.data.record);
  }

  return (
    <div
      ref={box}
      className="min-w-[160px]"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          done.current = true;
          onCancel();
        } else if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
          e.preventDefault();
          void commit();
        }
      }}
    >
      <AttributeField
        bare
        commitOnChange
        idPrefix={`cell-${rec.id}`}
        attr={attr}
        value={draft}
        disabled={busy}
        onChange={(v) => {
          draftRef.current = v;
          setDraft(v);
        }}
        onBlur={() => void commit()}
      />
      {error && <p role="alert" className="mt-1 text-[11.5px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

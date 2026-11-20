"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import type { AttributeDef } from "@/lib/data-model/types";
import { dataApi, formatValue } from "@/lib/data-model/client";

type Item = {
  id: number;
  attribute_slug: string | null;
  action: "create" | "update" | "delete" | "restore" | "import";
  old_value: unknown;
  new_value: unknown;
  actor_name: string;
  source: string;
  created_at: string;
};

/** Who changed what, newest first. Loaded when opened, so the record page stays fast. */
export function RecordHistory({ recordId, attributes, embedded = false }: { recordId: string; attributes: AttributeDef[]; embedded?: boolean }) {
  const [open, setOpen] = useState(embedded);
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Embedded in a tab, it loads as soon as it shows.
  useEffect(() => {
    if (!embedded) return;
    let live = true;
    void dataApi<{ history: Item[] }>(`/api/data/records/${recordId}/history`).then((r) => {
      if (!live) return;
      if (r.ok) setItems(r.data.history);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [embedded, recordId]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setError(null);
      const r = await dataApi<{ history: Item[] }>(`/api/data/records/${recordId}/history`);
      if (r.ok) setItems(r.data.history);
      else setError(r.error);
    }
  }

  function describe(h: Item): string {
    if (h.action === "delete") return h.source === "merge" ? "merged this record into another" : "deleted this record";
    if (h.action === "restore") return "restored this record";
    if (h.attribute_slug === null) {
      const merged = h.new_value as { merged_in?: string } | null;
      if (merged?.merged_in) return `merged "${merged.merged_in}" into this record`;
      if (h.action === "create") return "created this record";
      const from = (h.old_value as { name?: string } | null)?.name ?? "";
      const to = (h.new_value as { name?: string } | null)?.name ?? "";
      return `renamed it from "${from}" to "${to}"`;
    }
    const attr = attributes.find((a) => a.slug === h.attribute_slug);
    const label = attr?.name ?? h.attribute_slug;
    // A reference or a team member is an id; the name isn't kept in history, so say it was set.
    const show = (v: unknown) => (attr && attr.type !== "record_ref" && attr.type !== "member" ? formatValue(attr, v) : v ? "set" : "");
    const to = show(h.new_value);
    const from = show(h.old_value);
    if (h.action === "create") return `set ${label} to ${to}`;
    if (!to) return `cleared ${label}`;
    return from ? `changed ${label} from ${from} to ${to}` : `set ${label} to ${to}`;
  }

  const list = error ? (
    <p role="alert" className="text-[12.5px] text-[var(--color-danger)]">{error}</p>
  ) : items === null ? (
    <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-faint)]" />
  ) : items.length === 0 ? (
    <p className="text-[12.5px] text-[var(--color-text-muted)]">No changes recorded yet.</p>
  ) : (
    <ul className="space-y-2.5">
      {items.map((h) => (
        <li key={h.id} className="text-[13px]">
          <span className="font-semibold">{h.actor_name}</span> {describe(h)}
          <span className="ml-2 text-[12px] text-[var(--color-text-faint)]">
            {new Date(h.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
            {h.source === "migration" || h.source === "import" ? ` · ${h.source}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );

  if (embedded) return list;

  return (
    <div className="card">
      <button type="button" onClick={() => void toggle()} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] font-semibold">
        History
        <ChevronDown className={open ? "h-4 w-4 rotate-180 transition-transform" : "h-4 w-4 transition-transform"} />
      </button>
      {open && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          {error ? (
            <p role="alert" className="text-[12.5px] text-[var(--color-danger)]">{error}</p>
          ) : items === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-faint)]" />
          ) : items.length === 0 ? (
            <p className="text-[12.5px] text-[var(--color-text-muted)]">No changes recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((h) => (
                <li key={h.id} className="text-[13px]">
                  <span className="font-semibold">{h.actor_name}</span> {describe(h)}
                  <span className="ml-2 text-[12px] text-[var(--color-text-faint)]">
                    {new Date(h.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                    {h.source === "migration" || h.source === "import" ? ` · ${h.source}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

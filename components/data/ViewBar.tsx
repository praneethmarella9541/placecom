"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { dataApi, readDataCache, writeDataCache } from "@/lib/data-model/client";
import type { ViewConfig } from "@/lib/data-model/view-config";

type View = { id: string; name: string; config: ViewConfig; is_shared: boolean; mine: boolean };

const same = (a: ViewConfig, b: ViewConfig) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
/** Key order and "no filters" vs "empty filters" must not count as a change. */
function normalize(c: ViewConfig) {
  return {
    columns: c.columns ?? null,
    filters: (c.filters ?? []).map((f) => ({ attribute: f.attribute, op: f.op, value: f.value ?? null })),
    sort: c.sort ?? "name",
    direction: c.direction ?? "asc",
    // Sorted keys, so the order widths were set in doesn't count as a change.
    widths: Object.entries(c.widths ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  };
}

/**
 * Saved views of one object, as tabs along the top of the table: the default view first, then each
 * saved one. Changing a loaded view shows Update view; "+" saves the current setup as a new view.
 * `current` is what the table shows right now; `onApply` loads a view into it.
 */
export function ViewBar({
  objectSlug,
  defaultLabel,
  isAdmin,
  current,
  onApply,
}: {
  objectSlug: string;
  defaultLabel: string;
  isAdmin: boolean;
  current: ViewConfig;
  onApply: (config: ViewConfig) => void;
}) {
  const [views, setViews] = useState<View[]>(() => readDataCache<View[]>(`views:${objectSlug}`) ?? []);
  const [activeId, setActiveId] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    const r = await dataApi<{ views: View[] }>(`/api/data/views?object=${objectSlug}`);
    if (r.ok) {
      setViews(r.data.views);
      writeDataCache(`views:${objectSlug}`, r.data.views);
    }
    // A database without 0088 answers 503; the table still works with the default view.
  }, [objectSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = views.find((v) => v.id === activeId) ?? null;
  const dirty = active ? !same(active.config, current) : false;
  const canEdit = !!active && (active.mine || (active.is_shared && isAdmin));

  function pick(id: string) {
    setActiveId(id);
    setError(null);
    const v = views.find((x) => x.id === id);
    onApply(v ? v.config : {});
  }

  async function create() {
    setBusy(true);
    setError(null);
    const r = await dataApi<{ view: View }>("/api/data/views", { method: "POST", body: { object: objectSlug, name, config: current, shared: isAdmin && shared } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setViews((vs) => [...vs, r.data.view]);
    setActiveId(r.data.view.id);
    setNaming(false);
    setName("");
    setShared(false);
  }

  async function update() {
    if (!active) return;
    setBusy(true);
    setError(null);
    const r = await dataApi<{ view: View }>(`/api/data/views/${active.id}`, { method: "PATCH", body: { config: current } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setViews((vs) => vs.map((v) => (v.id === active.id ? r.data.view : v)));
  }

  async function remove() {
    if (!active) return;
    setBusy(true);
    const r = await dataApi(`/api/data/views/${active.id}`, { method: "DELETE" });
    setBusy(false);
    setConfirmDelete(false);
    if (!r.ok) return setError(r.error);
    setViews((vs) => vs.filter((v) => v.id !== active.id));
    pick("");
  }

  const tab = (isActive: boolean) =>
    cn(
      "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
      isActive
        ? "border-[var(--color-copper)] text-[var(--color-text)]"
        : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
    );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-1 border-b border-[var(--color-border)]">
        <div role="tablist" aria-label="Views" className="flex min-w-0 items-center overflow-x-auto">
          <button type="button" role="tab" aria-selected={activeId === ""} onClick={() => pick("")} className={tab(activeId === "")}>
            {defaultLabel}
          </button>
          {views.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={activeId === v.id} onClick={() => pick(v.id)} className={tab(activeId === v.id)}>
              {v.name}
              {v.is_shared && <span className="ml-1.5 text-[11px] font-medium text-[var(--color-text-faint)]">team</span>}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setNaming((n) => !n)} aria-label="Save as new view" title="Save as new view" className="ml-1 rounded-md p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]">
          <Plus className="h-4 w-4" />
        </button>

        <div className="ml-auto flex items-center gap-3 pb-1 text-[12.5px]">
          {dirty && canEdit && (
            <button type="button" disabled={busy} onClick={() => void update()} className="btn-primary-copper inline-flex h-8 items-center gap-1.5 px-3 text-[12.5px]">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Update view
            </button>
          )}
          {dirty && !canEdit && <span className="text-[var(--color-text-faint)]">Changed · use + to keep it as your own view</span>}
          {active && canEdit && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="font-semibold text-[var(--color-text-muted)] underline">
              Delete view
            </button>
          )}
        </div>
      </div>

      {naming && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input aria-label="View name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" maxLength={60} className="input-field h-8 w-[200px] text-[12.5px]" />
          {isAdmin && (
            <label className="flex items-center gap-1.5 text-[12.5px]">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with team
            </label>
          )}
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary-copper h-8 px-3 text-[12.5px]">Save view</button>
          <button type="button" onClick={() => setNaming(false)} className="btn-ghost h-8 px-2 text-[12.5px]">Cancel</button>
        </form>
      )}
      {error && <p role="alert" className="mt-1 text-[12.5px] text-[var(--color-danger)]">{error}</p>}

      {confirmDelete && active && (
        <ConfirmDialog
          title={`Delete the view "${active.name}"?`}
          body="Only the saved view is removed. No records are affected."
          confirmLabel="Delete"
          tone="danger"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { dataApi, type ObjectsResponse } from "@/lib/data-model/client";

export type ListSummary = { id: string; name: string; has_stages: boolean; data_objects: { slug: string } | { slug: string }[] };

export function ListsTab({ model }: { model: ObjectsResponse }) {
  const router = useRouter();
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [object, setObject] = useState(model.objects[0]?.slug ?? "people");
  const [stages, setStages] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void dataApi<{ lists: ListSummary[] }>("/api/data/lists").then((r) => (r.ok ? setLists(r.data.lists) : setError(r.error)));
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    const stageNames = stages.split(",").map((s) => s.trim()).filter(Boolean);
    const r = await dataApi<{ list: { id: string } }>("/api/data/lists", {
      method: "POST",
      body: { object, name, ...(stageNames.length ? { stages: stageNames } : {}) },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/data/lists/${r.data.list.id}`);
  }

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p>}

      {model.canWrite && (
        <form
          className="card flex flex-wrap items-end gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="min-w-[180px] flex-1">
            <label htmlFor="list-name" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">New list</label>
            <input id="list-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Campus drive 2026" className="input-field h-9 text-[13px]" />
          </div>
          <div>
            <label htmlFor="list-object" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Holds</label>
            <select id="list-object" value={object} onChange={(e) => setObject(e.target.value)} className="input-field select-chevron h-9 text-[13px]">
              {model.objects.map((o) => (
                <option key={o.slug} value={o.slug}>{o.plural_name}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px] flex-[2]">
            <label htmlFor="list-stages" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Stages (optional, comma separated)</label>
            <input id="list-stages" value={stages} onChange={(e) => setStages(e.target.value)} placeholder="New, In progress, Done" className="input-field h-9 text-[13px]" />
          </div>
          <button type="submit" disabled={busy || !name.trim()} className="btn-primary-copper h-9 gap-1.5 px-3 text-[12.5px]">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create list
          </button>
        </form>
      )}

      {lists === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-text-faint)]" />
      ) : lists.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)]">No lists yet. A list is a pipeline or a group, for example candidates for one drive.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((l) => (
            <li key={l.id}>
              <Link href={`/data/lists/${l.id}`} className="card block p-4 transition-colors hover:bg-[var(--color-surface-2)]">
                <p className="font-semibold">{l.name}</p>
                <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">
                  {(Array.isArray(l.data_objects) ? l.data_objects[0]?.slug : l.data_objects?.slug) ?? ""}
                  {l.has_stages ? " · pipeline" : " · group"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

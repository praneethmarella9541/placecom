"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import { dataApi } from "@/lib/data-model/client";
import { RecordAvatar } from "@/components/data/RecordAvatar";
import { RecordPicker } from "@/components/data/AttributeField";

type Group = { object_slug: string; object_name: string; attribute_slug: string; attribute_name: string; total: number; records: { id: string; name: string }[] };

/**
 * Records that point at this one: a company's people and deals, a person's deals. Adding one sets
 * that record's link field to this record; removing clears it. Both sides stay in step because there
 * is only one stored link.
 */
export function RelatedTab({ recordId, canWrite }: { recordId: string; canWrite: boolean }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await dataApi<{ groups: Group[] }>(`/api/data/records/${recordId}/related`);
    if (r.ok) setGroups(r.data.groups);
    else setError(r.error);
  }, [recordId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function link(g: Group, otherId: string) {
    const r = await dataApi(`/api/data/records/${otherId}`, { method: "PATCH", body: { values: { [g.attribute_slug]: recordId } } });
    if (!r.ok) return setError(r.error);
    setError(null);
    void load();
  }
  async function unlink(g: Group, otherId: string) {
    const r = await dataApi(`/api/data/records/${otherId}`, { method: "PATCH", body: { values: { [g.attribute_slug]: null } } });
    if (!r.ok) return setError(r.error);
    setError(null);
    void load();
  }

  if (groups === null) return error ? <p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p> : <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-faint)]" />;
  if (groups.length === 0) return <p className="text-[13px] text-[var(--color-text-muted)]">Nothing links to this kind of record yet. Add a &ldquo;link to another record&rdquo; field to another object to see it here.</p>;

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="text-[12.5px] text-[var(--color-danger)]">{error}</p>}
      {groups.map((g) => (
        <section key={`${g.object_slug}.${g.attribute_slug}`} aria-label={`${g.object_name} (${g.attribute_name})`}>
          <h3 className="mb-2 flex items-baseline gap-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {g.object_name}
            <span className="font-medium normal-case tracking-normal text-[var(--color-text-faint)]">via {g.attribute_name} · {g.total.toLocaleString("en-IN")}</span>
          </h3>
          {g.records.length > 0 && (
            <ul className="mb-2 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
              {g.records.map((rec) => (
                <li key={rec.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                  <Link href={`/data/${rec.id}`} className="flex min-w-0 items-center gap-2 font-semibold hover:underline">
                    <RecordAvatar name={rec.name} seed={rec.id} size={20} square={g.object_slug === "companies"} />
                    <span className="truncate">{rec.name || "Unnamed"}</span>
                  </Link>
                  {canWrite && (
                    <button type="button" aria-label={`Remove ${rec.name}`} onClick={() => void unlink(g, rec.id)} className="text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {g.total > g.records.length && <p className="mb-2 text-[12px] text-[var(--color-text-faint)]">Showing the first {g.records.length}.</p>}
          {canWrite && (
            <div className="max-w-[320px]">
              <RecordPicker targetObject={g.object_slug} value="" onChange={(id) => id && void link(g, id)} key={g.records.length} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

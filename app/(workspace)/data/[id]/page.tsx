"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, GitMerge, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttributeDef, ObjectDef, RecordRow } from "@/lib/data-model/types";
import { dataApi, type ObjectsResponse } from "@/lib/data-model/client";
import { AttributeField, samePayload, toInput, toPayload, type FieldInput } from "@/components/data/AttributeField";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RecordHistory } from "@/components/data/RecordHistory";
import { RecordAvatar } from "@/components/data/RecordAvatar";
import { MergeModal } from "@/components/data/MergeModal";
import { FavouriteButton } from "@/components/data/FavouriteButton";
import { InteractionBlock } from "@/components/data/InteractionBlock";
import { formatValue } from "@/lib/data-model/client";
import { NotesTab } from "@/components/data/tabs/NotesTab";
import { TasksTab } from "@/components/data/tabs/TasksTab";
import { EmailsTab } from "@/components/data/tabs/EmailsTab";
import { RelatedTab } from "@/components/data/tabs/RelatedTab";
import { useMeMailbox } from "@/lib/use-me-mailbox";

type RecordResponse = { record: RecordRow; object: ObjectDef; attributes: AttributeDef[] };
type ListOption = { id: string; name: string };
type Membership = { entry_id: string; list_id: string; list_name: string; stage_name: string | null; stage_color: string | null; stage_entered_at: string };

type Tab = "activity" | "notes" | "tasks" | "emails" | "related" | "lists";

export default function RecordPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const router = useRouter();
  const { me } = useMeMailbox();
  const [data, setData] = useState<RecordResponse | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | undefined>();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [form, setForm] = useState<Record<string, FieldInput>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<Tab>("activity");

  const hydrate = useCallback((r: RecordResponse) => {
    setData(r);
    setName(r.record.name);
    setForm(Object.fromEntries(r.attributes.map((a) => [a.slug, toInput(a, r.record.values[a.slug])])));
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.all([dataApi<RecordResponse>(`/api/data/records/${id}`), dataApi<ObjectsResponse>("/api/data/objects")]).then(([rec, objs]) => {
      if (!live) return;
      if (!rec.ok) return setLoadError(rec.status === 404 ? "This record doesn't exist or was deleted." : rec.error);
      hydrate(rec.data);
      if (objs.ok) {
        setCanWrite(objs.data.canWrite && objs.data.objects.find((o) => o.slug === rec.data.object.slug)?.access !== "read");
        setIsAdmin(objs.data.isAdmin);
        setUserId(objs.data.userId);
      }
    });
    return () => {
      live = false;
    };
  }, [id, hydrate]);

  /** Saves one field (or the name). Called when the user leaves it. */
  async function save(slug: string | "name") {
    if (!data || !canWrite) return;
    const attr = slug === "name" ? null : data.attributes.find((a) => a.slug === slug)!;
    const body =
      slug === "name"
        ? name.trim() === data.record.name ? null : { name }
        : samePayload(toPayload(attr!, form[slug]), data.record.values[slug]) ? null : { values: { [slug]: toPayload(attr!, form[slug]) } };
    if (!body) return;

    setSaving(slug);
    setErrors((e) => ({ ...e, [slug]: "" }));
    const r = await dataApi<{ record: RecordRow }>(`/api/data/records/${id}`, { method: "PATCH", body });
    setSaving(null);
    if (!r.ok) return setErrors((e) => ({ ...e, [slug]: r.errors?.length ? r.errors.join(" ") : r.error }));
    setData({ ...data, record: r.data.record });
    setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }));
  }

  async function remove() {
    setDeleting(true);
    const r = await dataApi<{ ok: true }>(`/api/data/records/${id}`, { method: "DELETE" });
    setDeleting(false);
    if (!r.ok) {
      setConfirmDelete(false);
      return setErrors((e) => ({ ...e, name: r.error }));
    }
    router.push("/data");
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-[900px] space-y-3">
        <Link href="/data" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Data
        </Link>
        <p role="alert" className="text-[13px] text-[var(--color-danger)]">{loadError}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex justify-center py-20 text-[var(--color-text-faint)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const attrs = data.attributes.filter((a) => !a.archived_at);
  const tabClass = (active: boolean) =>
    cn(
      "-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors",
      active ? "border-[var(--color-copper)] text-[var(--color-text)]" : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
    );

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/data" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <ArrowLeft className="h-3.5 w-3.5" /> {data.object.plural_name}
        </Link>
        <div className="flex items-center gap-4">
          <FavouriteButton kind="record" id={data.record.id} />
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-faint)]" aria-live="polite">
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </>
            ) : savedAt ? (
              <>
                <Check className="h-3 w-3" /> Saved {savedAt}
              </>
            ) : null}
          </span>
          {canWrite && (data.object.slug === "people" || data.object.slug === "companies") && (
            <button type="button" onClick={() => setMergeOpen(true)} className="btn-ghost inline-flex items-center gap-1.5 text-[12.5px]">
              <GitMerge className="h-3.5 w-3.5" /> Merge
            </button>
          )}
          {canWrite && me?.allowDelete && (
            <button type="button" onClick={() => setConfirmDelete(true)} className="btn-ghost inline-flex items-center gap-1.5 text-[12.5px] text-[var(--color-danger)]">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <RecordAvatar name={data.record.name} seed={data.record.id} size={44} square={data.object.slug === "companies"} />
        <div className="min-w-0 flex-1">
          <input
            aria-label="Name"
            value={name}
            disabled={!canWrite}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void save("name")}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-2xl font-bold tracking-tight text-[var(--color-text)] hover:border-[var(--color-border)] focus:border-[var(--color-border-strong)] focus:outline-none disabled:hover:border-transparent"
          />
          {errors.name && <p role="alert" className="mt-1 px-2 text-[12.5px] text-[var(--color-danger)]">{errors.name}</p>}
        </div>
      </div>

      {(() => {
        const pinned = (data.object.highlights ?? []).map((slug) => attrs.find((a) => a.slug === slug)).filter((a): a is AttributeDef => !!a && data.record.values[a.slug] !== undefined);
        if (!pinned.length) return null;
        return (
          <dl className="flex flex-wrap gap-x-8 gap-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3" aria-label="Highlights">
            {pinned.map((a) => (
              <div key={a.slug} className="min-w-0">
                <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">{a.name}</dt>
                <dd className="max-w-[260px] truncate text-[13px] font-medium">{a.type === "record_ref" || a.type === "member" ? "see below" : formatValue(a, data.record.values[a.slug])}</dd>
              </div>
            ))}
          </dl>
        );
      })()}

      <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <section aria-label="Details" className="card space-y-4 p-4">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Details</h2>
          {attrs.map((a) => (
            <div key={a.slug}>
              <AttributeField
                attr={a}
                value={form[a.slug] ?? ""}
                disabled={!canWrite}
                onChange={(v) => setForm((f) => ({ ...f, [a.slug]: v }))}
                onBlur={() => void save(a.slug)}
              />
              {errors[a.slug] && <p role="alert" className="mt-1 text-[12.5px] text-[var(--color-danger)]">{errors[a.slug]}</p>}
            </div>
          ))}
          {(data.object.slug === "people" || data.object.slug === "companies") && (
            <InteractionBlock recordId={data.record.id} isCompany={data.object.slug === "companies"} />
          )}
          <p className="border-t border-[var(--color-border)] pt-3 text-[12px] text-[var(--color-text-faint)]">
            Added {new Date(data.record.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </section>

        <section aria-label="Record activity" className="min-w-0">
          <div role="tablist" aria-label="Record" className="flex overflow-x-auto border-b border-[var(--color-border)]">
            {(
              [
                ["activity", "Activity"],
                ["notes", "Notes"],
                ["tasks", "Tasks"],
                ...(data.object.slug === "people" || data.object.slug === "companies" ? ([["emails", "Emails"]] as const) : []),
                ["related", "Related"],
                ["lists", "Lists"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn(tabClass(tab === key), "whitespace-nowrap")}>
                {label}
              </button>
            ))}
          </div>
          <div className="pt-4">
            {tab === "activity" && <RecordHistory embedded recordId={data.record.id} attributes={data.attributes} />}
            {tab === "notes" && <NotesTab recordId={data.record.id} canWrite={canWrite} isAdmin={isAdmin} />}
            {tab === "tasks" && <TasksTab recordId={data.record.id} canWrite={canWrite} isAdmin={isAdmin} userId={userId} />}
            {tab === "emails" && <EmailsTab recordId={data.record.id} />}
            {tab === "related" && <RelatedTab recordId={data.record.id} canWrite={canWrite} />}
            {tab === "lists" && <RecordLists recordId={data.record.id} objectSlug={data.object.slug} canWrite={canWrite} />}
          </div>
        </section>
      </div>

      {mergeOpen && (
        <MergeModal
          recordId={data.record.id}
          recordName={data.record.name}
          objectSlug={data.object.slug}
          singular={data.object.singular_name.toLowerCase()}
          onClose={() => setMergeOpen(false)}
          onMerged={(winnerId) => {
            setMergeOpen(false);
            if (winnerId === data.record.id) window.location.reload();
            else router.push(`/data/${winnerId}`);
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${data.record.name || "this record"}?`}
          body="It is removed from every list. Their email stays free to use again. This can't be undone from the app."
          confirmLabel="Delete"
          tone="danger"
          busy={deleting}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

/** The lists this record is on, with its stage in each, and a way to put it on another. */
function RecordLists({ recordId, objectSlug, canWrite }: { recordId: string; objectSlug: string; canWrite: boolean }) {
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [lists, setLists] = useState<ListOption[]>([]);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await dataApi<{ memberships: Membership[] }>(`/api/data/records/${recordId}/lists`);
    if (r.ok) setMemberships(r.data.memberships);
    else setError(r.error);
  }, [recordId]);

  useEffect(() => {
    void load();
    void dataApi<{ lists: ListOption[] }>(`/api/data/lists?object=${objectSlug}`).then((r) => r.ok && setLists(r.data.lists));
  }, [load, objectSlug]);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await dataApi(`/api/data/lists/${choice}/entries`, { method: "POST", body: { recordId } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setChoice("");
    void load();
  }

  const onIt = new Set((memberships ?? []).map((m) => m.list_id));
  const available = lists.filter((l) => !onIt.has(l.id));

  return (
    <div className="space-y-4">
      {memberships === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-faint)]" />
      ) : memberships.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-muted)]">Not on any list yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {memberships.map((m) => (
            <li key={m.entry_id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
              <Link href={`/data/lists/${m.list_id}`} className="font-semibold hover:underline">{m.list_name}</Link>
              <span className="flex items-center gap-2 text-[12.5px] text-[var(--color-text-muted)]">
                {m.stage_name && (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--color-surface-offset)] px-1.5 py-0.5 font-medium text-[var(--color-text)]">
                    {m.stage_color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: m.stage_color }} aria-hidden />}
                    {m.stage_name}
                  </span>
                )}
                since {new Date(m.stage_entered_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {canWrite && available.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="add-to-list" className="mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Add to a list</label>
            <select id="add-to-list" value={choice} onChange={(e) => setChoice(e.target.value)} className="input-field select-chevron h-9 text-[13px]">
              <option value="">Choose a list…</option>
              {available.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <button type="button" disabled={!choice || busy} onClick={() => void add()} className="btn-primary-copper h-9 px-3 text-[12.5px]">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-[12.5px] text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

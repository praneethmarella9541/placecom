"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, ChevronDown, Clock, Loader2, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttributeDef } from "@/lib/data-model/types";
import { dataApi, formatValue, type ObjectsResponse } from "@/lib/data-model/client";
import { AttributeField, RecordPicker, samePayload, toInput, toPayload, type FieldInput } from "@/components/data/AttributeField";
import { AttributesModal } from "@/components/data/AttributesModal";
import { RulesModal } from "@/components/data/RulesModal";
import { StageGateDialog } from "@/components/data/StageGateDialog";
import { FavouriteButton } from "@/components/data/FavouriteButton";
import { RecordAvatar } from "@/components/data/RecordAvatar";

type Stage = { id: string; name: string; color: string | null; position: number; is_closed: boolean; target_days: number | null };
type Entry = {
  id: string;
  record_id: string;
  stage_id: string | null;
  position: number;
  stage_entered_at: string;
  values: Record<string, unknown>;
  record: { id: string; name: string; values: Record<string, unknown> };
};
type ListResponse = {
  list: { id: string; name: string; object_id: string; has_stages: boolean };
  stages: Stage[];
  entries: Entry[];
  attributes: AttributeDef[];
  total: number;
};

const NO_STAGE = "none";

export default function ListPage(props: { params: Promise<{ id: string }> }) {
  const { id } = use(props.params);
  const [list, setList] = useState<ListResponse["list"] | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [attributes, setAttributes] = useState<AttributeDef[]>([]);
  const [objects, setObjects] = useState<ObjectsResponse["objects"]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [objectSlug, setObjectSlug] = useState("people");
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [newStage, setNewStage] = useState("");
  const [pick, setPick] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [targetFor, setTargetFor] = useState<string | null>(null);
  const [targetDays, setTargetDays] = useState("");
  const [gate, setGate] = useState<{ entryId: string; stageId: string; stageName: string; missingFields: string[] } | null>(null);

  const load = useCallback(async () => {
    const [r, objs] = await Promise.all([
      dataApi<ListResponse>(`/api/data/lists/${id}?pageSize=100`),
      dataApi<ObjectsResponse>("/api/data/objects"),
    ]);
    if (!r.ok) return setError(r.status === 404 ? "This list doesn't exist or was archived." : r.error);
    setError(null);
    setList(r.data.list);
    setStages(r.data.stages);
    setEntries(r.data.entries);
    setAttributes(r.data.attributes);
    if (objs.ok) {
      setObjects(objs.data.objects);
      setIsAdmin(objs.data.isAdmin);
      setCanWrite(objs.data.canWrite && objs.data.objects.find((o) => o.id === r.data.list.object_id)?.access !== "read");
      setObjectSlug(objs.data.objects.find((o) => o.id === r.data.list.object_id)?.slug ?? "people");
    }
    if (r.data.total > r.data.entries.length) {
      setNotice(`Showing the first ${r.data.entries.length} of ${r.data.total.toLocaleString("en-IN")} entries.`);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(entryId: string, stageId: string) {
    const entry = entries.find((e) => e.id === entryId);
    if (!entry || entry.stage_id === stageId) return;
    const before = entries;
    // Move it on screen at once; put it back if the server says no.
    setEntries((es) => es.map((e) => (e.id === entryId ? { ...e, stage_id: stageId } : e)));
    const r = await dataApi(`/api/data/lists/${id}/entries/${entryId}`, { method: "PATCH", body: { stageId } });
    if (!r.ok) {
      setEntries(before);
      if (r.missingFields?.length) {
        setGate({ entryId, stageId, stageName: stages.find((s) => s.id === stageId)?.name ?? "this stage", missingFields: r.missingFields });
      } else {
        setError(r.errors?.length ? r.errors.join(" ") : r.error);
      }
    } else setError(null);
  }

  async function moveSelected() {
    if (!bulkStage) return;
    setBulkBusy(true);
    const ids = [...selected];
    const results = await Promise.all(ids.map((entryId) => dataApi(`/api/data/lists/${id}/entries/${entryId}`, { method: "PATCH", body: { stageId: bulkStage } })));
    setBulkBusy(false);
    const failed = results.filter((r) => !r.ok).length;
    setError(failed ? `${failed} of ${ids.length} couldn't be moved.` : null);
    setSelected(new Set());
    setBulkStage("");
    void load();
  }

  async function saveTarget(stageId: string) {
    const r = await dataApi(`/api/data/lists/${id}/stages/${stageId}`, { method: "PATCH", body: { targetDays: targetDays.trim() ? Number(targetDays) : null } });
    if (!r.ok) return setError(r.error);
    setError(null);
    setTargetFor(null);
    void load();
  }

  async function addRecord(recordId: string) {
    setPick("");
    const r = await dataApi(`/api/data/lists/${id}/entries`, { method: "POST", body: { recordId } });
    if (!r.ok) return setError(r.error);
    setError(null);
    void load();
  }

  async function addStage() {
    const r = await dataApi(`/api/data/lists/${id}/stages`, { method: "POST", body: { name: newStage } });
    if (!r.ok) return setError(r.error);
    setNewStage("");
    setError(null);
    void load();
  }

  async function removeEntry(entryId: string) {
    const r = await dataApi(`/api/data/lists/${id}/entries/${entryId}`, { method: "DELETE" });
    if (!r.ok) return setError(r.error);
    setEntries((es) => es.filter((e) => e.id !== entryId));
  }

  if (!list) {
    return error ? (
      <div className="mx-auto max-w-[900px] space-y-3">
        <Link href="/data" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-text-muted)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Data
        </Link>
        <p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p>
      </div>
    ) : (
      <div className="flex justify-center py-20 text-[var(--color-text-faint)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // What a column adds up: a money or number field on the entries, or a deal's value.
  const sumAttr = attributes.find((a) => !a.archived_at && (a.type === "currency" || a.type === "number")) ?? null;
  const amountOf = (e: Entry): number | null => {
    const v = sumAttr ? e.values[sumAttr.slug] : objectSlug === "deals" ? e.record.values.value : undefined;
    return typeof v === "number" ? v : null;
  };
  const showSum = !!sumAttr || objectSlug === "deals";
  const daysIn = (e: Entry) => Math.max(0, Math.floor((Date.now() - Date.parse(e.stage_entered_at)) / 86_400_000));

  const columns: { id: string; name: string; color: string | null; target_days?: number | null }[] = list.has_stages
    ? [...(entries.some((e) => !e.stage_id) ? [{ id: NO_STAGE, name: "No stage", color: null }] : []), ...stages]
    : [{ id: NO_STAGE, name: "Everyone", color: null }];

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <Link href="/data" className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Data
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-1 font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
          {list.name}
          <FavouriteButton kind="list" id={list.id} />
        </h1>
        <Link href={`/data/lists/${id}/report`} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]">
          <BarChart3 className="h-3.5 w-3.5" /> Report
        </Link>
        {isAdmin && list.has_stages && (
          <button type="button" onClick={() => setRulesOpen(true)} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]">
            <ShieldCheck className="h-3.5 w-3.5" /> Rules
          </button>
        )}
        {isAdmin && (
          <button type="button" onClick={() => setFieldsOpen(true)} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Fields
          </button>
        )}
        {canWrite && (
          <div className="w-[260px]">
            <RecordPicker key={entries.length} targetObject={objectSlug} value={pick} onChange={(v) => v && void addRecord(v)} />
          </div>
        )}
      </div>

      {error && <p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p>}
      {notice && <p className="text-[12.5px] text-[var(--color-text-muted)]">{notice}</p>}

      {selected.size > 0 && canWrite && list.has_stages && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-[13px]" role="region" aria-label="Selected cards">
          <span className="font-semibold">{selected.size} selected</span>
          <select aria-label="Move to stage" value={bulkStage} onChange={(e) => setBulkStage(e.target.value)} className="input-field select-chevron h-8 w-[190px] text-[12.5px]">
            <option value="">Move to…</option>
            {stages.map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
          <button type="button" disabled={!bulkStage || bulkBusy} onClick={() => void moveSelected()} className="btn-primary-copper inline-flex h-8 items-center gap-1.5 px-3 text-[12.5px]">
            {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Move
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-[12.5px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Clear</button>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((col) => {
          const items = entries
            .filter((e) => (col.id === NO_STAGE ? !e.stage_id || !list.has_stages : e.stage_id === col.id))
            .sort((a, b) => a.position - b.position);
          return (
            <section
              key={col.id}
              aria-label={col.name}
              onDragOver={(e) => {
                if (!canWrite || !dragId || col.id === NO_STAGE) return;
                e.preventDefault();
                setOverStage(col.id);
              }}
              onDragLeave={() => setOverStage((s) => (s === col.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setOverStage(null);
                if (dragId && col.id !== NO_STAGE) void move(dragId, col.id);
                setDragId(null);
              }}
              className={cn(
                "w-[280px] shrink-0 rounded-xl border bg-[var(--color-surface-offset)] p-2",
                overStage === col.id ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"
              )}
            >
              <h2 className="flex items-center justify-between gap-2 px-2 py-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                <span className="flex min-w-0 items-center gap-2">
                  {col.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: col.color }} aria-hidden />}
                  <span className="truncate">{col.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {canWrite && col.id !== NO_STAGE && list.has_stages && (
                    <button
                      type="button"
                      aria-label={`Target time for ${col.name}`}
                      title={col.target_days ? `Target ${col.target_days} days` : "Set a target time"}
                      onClick={() => {
                        setTargetFor(targetFor === col.id ? null : col.id);
                        setTargetDays(col.target_days ? String(col.target_days) : "");
                      }}
                      className={cn("normal-case", col.target_days ? "text-[var(--color-text-muted)]" : "text-[var(--color-text-faint)]", "hover:text-[var(--color-text)]")}
                    >
                      <Clock className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <span className="tabular-nums">{items.length}</span>
                </span>
              </h2>
              {showSum && items.length > 0 && (
                <p className="px-2 pb-1 text-[12px] font-medium text-[var(--color-text-faint)]">
                  {(sumAttr?.type === "number" ? "" : "₹ ") + items.reduce((t, e) => t + (amountOf(e) ?? 0), 0).toLocaleString("en-IN")}
                </p>
              )}
              {targetFor === col.id && (
                <form
                  className="mb-2 flex items-center gap-2 px-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveTarget(col.id);
                  }}
                >
                  <input aria-label="Target days" inputMode="numeric" value={targetDays} onChange={(e) => setTargetDays(e.target.value)} placeholder="Days" className="input-field h-7 w-[70px] text-[12px]" />
                  <button type="submit" className="btn-primary-copper h-7 px-2 text-[12px]">Set</button>
                  <button type="button" onClick={() => setTargetFor(null)} className="text-[12px] text-[var(--color-text-faint)]">Cancel</button>
                </form>
              )}
              <ul className="space-y-2">
                {items.map((entry) => (
                  <li
                    key={entry.id}
                    draggable={canWrite && list.has_stages}
                    onDragStart={() => setDragId(entry.id)}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    className={cn("card p-3", dragId === entry.id && "opacity-50")}
                  >
                    <div className="flex items-center gap-2">
                      {canWrite && list.has_stages && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${entry.record.name || "card"}`}
                          checked={selected.has(entry.id)}
                          onChange={(e) =>
                            setSelected((cur) => {
                              const next = new Set(cur);
                              if (e.target.checked) next.add(entry.id);
                              else next.delete(entry.id);
                              return next;
                            })
                          }
                        />
                      )}
                      <Link href={`/data/${entry.record_id}`} className="flex min-w-0 flex-1 items-center gap-2 text-[13px] font-semibold hover:underline">
                        <RecordAvatar name={entry.record.name} seed={entry.record_id} size={22} />
                        <span className="truncate">{entry.record.name || "Unnamed"}</span>
                      </Link>
                    </div>
                    {list.has_stages && entry.stage_id && (
                      <p className={cn("mt-1 inline-flex items-center gap-1 text-[11.5px]", col.target_days && daysIn(entry) > col.target_days ? "font-semibold text-[var(--color-danger)]" : "text-[var(--color-text-faint)]")}>
                        <Clock className="h-3 w-3" aria-hidden />
                        {col.target_days && daysIn(entry) > col.target_days ? `Late · ${daysIn(entry)}d (target ${col.target_days}d)` : `${daysIn(entry)}d in stage`}
                      </p>
                    )}
                    <EntryFields
                      entry={entry}
                      attributes={attributes.filter((a) => !a.archived_at)}
                      listId={id}
                      canWrite={canWrite}
                      onSaved={(values) => setEntries((es) => es.map((e) => (e.id === entry.id ? { ...e, values } : e)))}
                    />
                    {canWrite && (
                      <div className="mt-2 flex items-center gap-2">
                        {list.has_stages && (
                          <select
                            aria-label={`Stage for ${entry.record.name}`}
                            value={entry.stage_id ?? ""}
                            onChange={(e) => void move(entry.id, e.target.value)}
                            className="input-field select-chevron h-7 flex-1 text-[12px]"
                          >
                            {!entry.stage_id && <option value="">No stage</option>}
                            {stages.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        )}
                        <button type="button" onClick={() => void removeEntry(entry.id)} className="text-[12px] text-[var(--color-text-faint)] hover:text-[var(--color-danger)]">
                          Remove
                        </button>
                      </div>
                    )}
                  </li>
                ))}
                {items.length === 0 && <li className="px-2 py-4 text-center text-[12px] text-[var(--color-text-faint)]">Empty</li>}
              </ul>
            </section>
          );
        })}

        {canWrite && list.has_stages && (
          <form
            className="w-[240px] shrink-0 space-y-2 rounded-xl border border-dashed border-[var(--color-border-strong)] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newStage.trim()) void addStage();
            }}
          >
            <label htmlFor="new-stage" className="block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Add a stage</label>
            <input id="new-stage" value={newStage} onChange={(e) => setNewStage(e.target.value)} placeholder="Offer made" className="input-field h-9 text-[13px]" />
            <button type="submit" disabled={!newStage.trim()} className="btn-ghost inline-flex items-center gap-1.5 text-[12.5px]">
              <Plus className="h-3.5 w-3.5" /> Add stage
            </button>
          </form>
        )}
      </div>
      {rulesOpen && list && (
        <RulesModal
          mode="stage"
          listId={id}
          stages={stages.map((s) => ({ id: s.id, name: s.name }))}
          attributes={objects.find((o) => o.id === list.object_id)?.attributes ?? []}
          title="Rules for moving cards"
          onClose={() => setRulesOpen(false)}
        />
      )}

      {fieldsOpen && list && (
        <AttributesModal
          title="Fields on this list"
          base={`/api/data/lists/${id}`}
          attributes={attributes}
          objects={objects}
          onChanged={() => void load()}
          onClose={() => setFieldsOpen(false)}
        />
      )}

      {gate && list && (() => {
        const entry = entries.find((e) => e.id === gate.entryId);
        if (!entry) return null;
        return (
          <StageGateDialog
            title={gate.stageName}
            recordId={entry.record_id}
            attrs={objects.find((o) => o.id === list.object_id)?.attributes ?? []}
            missingFields={gate.missingFields}
            values={entry.record.values}
            onClose={() => setGate(null)}
            onFilled={() => {
              const { entryId, stageId } = gate;
              setGate(null);
              void move(entryId, stageId);
            }}
          />
        );
      })()}
    </div>
  );
}

/** The list's own fields on one card: the first few values as a summary, and an editor when opened. */
function EntryFields({
  entry,
  attributes,
  listId,
  canWrite,
  onSaved,
}: {
  entry: Entry;
  attributes: AttributeDef[];
  listId: string;
  canWrite: boolean;
  onSaved: (values: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, FieldInput>>({});
  const [error, setError] = useState<string | null>(null);

  if (attributes.length === 0) return null;

  const summary = attributes
    .filter((a) => entry.values[a.slug] !== undefined && a.type !== "record_ref" && a.type !== "member")
    .slice(0, 2)
    .map((a) => `${a.name}: ${formatValue(a, entry.values[a.slug])}`);

  function toggle() {
    if (!open) setForm(Object.fromEntries(attributes.map((a) => [a.slug, toInput(a, entry.values[a.slug])])));
    setError(null);
    setOpen(!open);
  }

  async function save(attr: AttributeDef) {
    const payload = toPayload(attr, form[attr.slug] ?? "");
    if (samePayload(payload, entry.values[attr.slug])) return;
    const r = await dataApi<{ entry: { values: Record<string, unknown> } }>(`/api/data/lists/${listId}/entries/${entry.id}`, {
      method: "PATCH",
      body: { values: { [attr.slug]: payload } },
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    onSaved(r.data.entry.values);
  }

  return (
    <div className="mt-1.5">
      {summary.length > 0 && <p className="truncate text-[12px] text-[var(--color-text-muted)]">{summary.join(" · ")}</p>}
      {canWrite && (
        <button type="button" onClick={toggle} aria-expanded={open} className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          Details <ChevronDown className={open ? "h-3 w-3 rotate-180" : "h-3 w-3"} />
        </button>
      )}
      {open && (
        <div className="mt-2 space-y-2.5 border-t border-[var(--color-border)] pt-2.5">
          {attributes.map((a) => (
            <AttributeField
              key={a.slug}
              attr={a}
              idPrefix={`entry-${entry.id}`}
              value={form[a.slug] ?? ""}
              onChange={(v) => setForm((f) => ({ ...f, [a.slug]: v }))}
              onBlur={() => void save(a)}
            />
          ))}
          {error && <p role="alert" className="text-[12px] text-[var(--color-danger)]">{error}</p>}
        </div>
      )}
    </div>
  );
}

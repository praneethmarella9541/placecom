"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown, ArrowUp, Box, Building2, ChevronLeft, ChevronRight, CircleDollarSign, Download, KanbanSquare, ShieldCheck, Star, Upload, Loader2, Plus, Search, SlidersHorizontal, Users, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AttributeDef, RecordFilter, RecordRow } from "@/lib/data-model/types";
import { clearDataCache, dataApi, formatValue, prefetchRecords, readDataCache, recordsUrl, writeDataCache, type ObjectsResponse, type ObjectWithAttributes, type RecordsResponse } from "@/lib/data-model/client";
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, type ViewConfig } from "@/lib/data-model/view-config";
import { SetupPanel } from "@/components/data/SetupPanel";
import { NewRecordModal } from "@/components/data/NewRecordModal";
import { NewObjectModal } from "@/components/data/NewObjectModal";
import { AttributesModal } from "@/components/data/AttributesModal";
import { ColumnPicker } from "@/components/data/ColumnPicker";
import { FilterBar } from "@/components/data/FilterBar";
import { SimpleDropdown, type DropdownOption } from "@/components/SimpleDropdown";
import { useModuleVisibility } from "@/lib/module-visibility";
import { ListsTab, type ListSummary } from "@/components/data/ListsTab";
import { ViewBar } from "@/components/data/ViewBar";
import { RecordAvatar } from "@/components/data/RecordAvatar";
import { CellEditor } from "@/components/data/CellEditor";
import { ImportModal } from "@/components/data/ImportModal";
import { RulesModal } from "@/components/data/RulesModal";
import { TypeIcon } from "@/components/data/typeIcons";

const PAGE_SIZE = 50;
const LISTS_TAB = "__lists__";

const OBJECT_ICONS: Record<string, React.ElementType> = { people: Users, companies: Building2, deals: CircleDollarSign };

export default function DataPage() {
  const [model, setModel] = useState<ObjectsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<string>("");
  const [newObjectOpen, setNewObjectOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [favourites, setFavourites] = useState<{ kind: "record" | "list"; id: string; name: string }[]>([]);

  const loadModel = useCallback(async () => {
    const r = await dataApi<ObjectsResponse>("/api/data/objects");
    if (!r.ok) return setError(r.error);
    setError(null);
    setModel(r.data);
    setTab((t) => t || r.data.objects[0]?.slug || "");
  }, []);

  useEffect(() => {
    void loadModel();
    void dataApi<{ lists: ListSummary[] }>("/api/data/lists").then((r) => r.ok && setLists(r.data.lists));
    void dataApi<{ favourites: { kind: "record" | "list"; id: string; name: string }[] }>("/api/data/favourites").then((r) => r.ok && setFavourites(r.data.favourites));
  }, [loadModel]);

  // Once we know the objects, load the first page of each in the background so a tab opens at once.
  const objectSlugs = model?.objects.map((o) => o.slug).join(",") ?? "";
  useEffect(() => {
    if (!objectSlugs) return;
    const t = setTimeout(() => objectSlugs.split(",").forEach((slug) => void prefetchRecords(slug)), 400);
    return () => clearTimeout(t);
  }, [objectSlugs]);

  if (error) {
    return <p role="alert" className="mx-auto max-w-[1500px] text-[13px] text-[var(--color-danger)]">{error}</p>;
  }
  if (!model) {
    return (
      <div className="flex justify-center py-20 text-[var(--color-text-faint)]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (model.objects.length === 0) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-5">
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">Data</h1>
        {model.isAdmin ? (
          <SetupPanel hasObjects={false} onDone={() => void loadModel()} />
        ) : (
          <p className="text-[13px] text-[var(--color-text-muted)]">Your admin hasn&apos;t set up the data model yet.</p>
        )}
      </div>
    );
  }

  // A deleted object leaves tab pointing at nothing; fall back to the first one.
  const active = model.objects.find((o) => o.slug === tab) ?? (tab === LISTS_TAB ? null : (model.objects[0] ?? null));
  const railItem = (isActive: boolean) =>
    cn(
      "flex w-full items-center gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors",
      isActive ? "bg-[var(--color-surface-offset)] text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
    );

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 md:flex-row md:gap-6">
      <aside aria-label="Data" className="shrink-0 md:w-[200px]">
        <nav className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
          <p className="hidden px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)] md:block">Objects</p>
          {model.objects.map((o) => {
            const Icon = OBJECT_ICONS[o.slug] ?? Box;
            return (
              <button key={o.slug} type="button" onClick={() => setTab(o.slug)} aria-current={tab === o.slug ? "page" : undefined} className={railItem(tab === o.slug)}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {o.plural_name}
              </button>
            );
          })}
          {model.isAdmin && (
            <button type="button" onClick={() => setNewObjectOpen(true)} className={cn(railItem(false), "font-medium")}>
              <Plus className="h-4 w-4 shrink-0" aria-hidden /> New object
            </button>
          )}
          {model.isAdmin && (
            <button type="button" onClick={() => setImportOpen(true)} className={cn(railItem(false), "font-medium")}>
              <Download className="h-4 w-4 shrink-0 rotate-180" aria-hidden /> Copy from CRM
            </button>
          )}

          {favourites.length > 0 && (
            <>
              <p className="hidden px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)] md:block">Favourites</p>
              {favourites.map((f) => (
                <Link key={`${f.kind}-${f.id}`} href={f.kind === "list" ? `/data/lists/${f.id}` : `/data/${f.id}`} className={railItem(false)}>
                  <Star className="h-4 w-4 shrink-0 fill-current" aria-hidden />
                  <span className="truncate">{f.name}</span>
                </Link>
              ))}
            </>
          )}

          <p className="hidden px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)] md:block">Lists</p>
          {lists.map((l) => (
            <Link key={l.id} href={`/data/lists/${l.id}`} className={railItem(false)}>
              <KanbanSquare className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{l.name}</span>
            </Link>
          ))}
          <button type="button" onClick={() => setTab(LISTS_TAB)} className={cn(railItem(tab === LISTS_TAB), "font-medium")}>
            <Plus className="h-4 w-4 shrink-0" aria-hidden /> {lists.length ? "All lists" : "New list"}
          </button>
        </nav>
      </aside>

      <main className="min-w-0 flex-1 space-y-3">
        {tab === LISTS_TAB ? (
          <>
            <h1 className="font-display text-xl font-bold tracking-tight">Lists</h1>
            <ListsTab model={model} />
          </>
        ) : active ? (
          <RecordsTable key={active.slug} object={active} objects={model.objects} canWrite={model.canWrite && active.access !== "read"} isAdmin={model.isAdmin} userId={model.userId} onSetup={() => void loadModel()} />
        ) : null}
      </main>

      {importOpen && (
        <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setImportOpen(false)}>
          <div className="my-8 w-full max-w-[720px]" role="dialog" aria-label="Copy from CRM">
            <SetupPanel
              hasObjects
              onDone={() => setImportOpen(false)}
              onChanged={() => {
                void loadModel();
                void dataApi<{ lists: ListSummary[] }>("/api/data/lists").then((r) => r.ok && setLists(r.data.lists));
              }}
            />
          </div>
        </div>
      )}

      {newObjectOpen && (
        <NewObjectModal
          onClose={() => setNewObjectOpen(false)}
          onCreated={(slug) => {
            setNewObjectOpen(false);
            void loadModel().then(() => setTab(slug));
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Records table
// ---------------------------------------------------------------------------

const SOURCE_OPTIONS: DropdownOption<"all" | "common" | "byom">[] = [
  { value: "all", label: "All contacts" },
  { value: "common", label: "Common mailbox contacts" },
  { value: "byom", label: "BYOM contacts" },
];

const COMPANY_SOURCE_OPTIONS: DropdownOption<"all" | "common" | "byom">[] = [
  { value: "all", label: "All companies" },
  { value: "common", label: "Common mailbox companies" },
  { value: "byom", label: "BYOM companies" },
];

function RecordsTable({
  object,
  objects,
  canWrite,
  isAdmin,
  userId,
  onSetup,
}: {
  object: ObjectWithAttributes;
  objects: ObjectWithAttributes[];
  canWrite: boolean;
  isAdmin: boolean;
  userId?: string;
  onSetup: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  // The default first page, if it was loaded recently: shown straight away while the real request runs.
  const [data, setData] = useState<RecordsResponse | null>(() => readDataCache<RecordsResponse>(recordsUrl(object.slug)) ?? null);
  const [loading, setLoading] = useState(() => !readDataCache(recordsUrl(object.slug)));
  const [error, setError] = useState<string | null>(null);
  const [refNames, setRefNames] = useState<Record<string, string>>(() => readDataCache<RecordsResponse>(recordsUrl(object.slug))?.names ?? {});
  const [creating, setCreating] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [filters, setFilters] = useState<RecordFilter[]>([]);
  // BYOM: People and Companies seen in the common mailbox / in any individual mailbox. Not part of a saved view.
  const sourceEnabled = useModuleVisibility().isVisible("byom") && (object.slug === "people" || object.slug === "companies");
  const [source, setSource] = useState<"all" | "common" | "byom">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<{ id: string; slug: string } | null>(null);
  const [reload, setReload] = useState(0);

  const visibleAttributes = useMemo(() => object.attributes.filter((a) => !a.archived_at), [object]);
  // null = the default view's columns: the first few fields, minus long text.
  const [columnSlugs, setColumnSlugs] = useState<string[] | null>(null);
  const columns = useMemo(() => {
    if (columnSlugs) {
      const by = new Map(visibleAttributes.map((a) => [a.slug, a]));
      return columnSlugs.map((s) => by.get(s)).filter((a): a is AttributeDef => !!a);
    }
    return visibleAttributes.filter((a) => a.type !== "long_text").slice(0, 6);
  }, [visibleAttributes, columnSlugs]);

  // Column widths in pixels. Remembered in this browser per object, and saved with a view.
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`data-widths:${object.slug}`) ?? "{}") as Record<string, number>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`data-widths:${object.slug}`, JSON.stringify(widths));
    } catch {
      /* storage blocked: widths just aren't remembered */
    }
  }, [object.slug, widths]);
  const widthOf = (key: string) => widths[key] ?? (key === "name" ? 260 : 180);
  const setWidth = (key: string, w: number) => setWidths((cur) => ({ ...cur, [key]: Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(w))) }));
  const resetWidth = (key: string) =>
    setWidths((cur) => {
      const next = { ...cur };
      delete next[key];
      return next;
    });

  function applyView(config: ViewConfig) {
    setWidths(config.widths ?? {});
    setColumnSlugs(config.columns ?? null);
    setFilters(config.filters ?? []);
    setSort(config.sort ?? "name");
    setDirection(config.direction ?? "asc");
    setPage(1);
  }

  // Names for team-member columns (a deal's owner): one small request, only when such a column shows.
  const hasMemberAttribute = visibleAttributes.some((c) => c.type === "member");
  useEffect(() => {
    if (!hasMemberAttribute) return;
    let live = true;
    void dataApi<{ members: { id: string; name: string }[] }>("/api/data/members").then((r) => {
      if (!live || !r.ok) return;
      setMembers(r.data.members);
      setRefNames((prev) => ({ ...prev, ...Object.fromEntries(r.data.members.map((m) => [m.id, m.name])) }));
    });
    return () => {
      live = false;
    };
  }, [hasMemberAttribute]);

  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let live = true;
    const params = new URLSearchParams({ object: object.slug, sort, direction, page: String(page), pageSize: String(PAGE_SIZE) });
    if (term) params.set("q", term);
    if (sourceEnabled && source !== "all") params.set("source", source);
    for (const f of filters) params.append("filter", `${f.attribute}:${f.op}${f.value ? `:${f.value}` : ""}`);
    const url = `/api/data/records?${params}`;

    // Something already on screen from the cache stays there while this refreshes; a different query
    // (another page, a filter) has nothing to show yet, so it shows the loading state.
    const cached = readDataCache<RecordsResponse>(url);
    if (cached) {
      setData(cached);
      setRefNames((prev) => ({ ...prev, ...(cached.names ?? {}) }));
    }
    setLoading(!cached);

    void dataApi<RecordsResponse>(url).then((r) => {
      if (!live) return;
      setLoading(false);
      if (!r.ok) return setError(r.error);
      setError(null);
      setData(r.data);
      setSelected(new Set());
      setRefNames((prev) => ({ ...prev, ...(r.data.names ?? {}) }));
      writeDataCache(url, r.data);
    });
    return () => {
      live = false;
    };
  }, [object.slug, sort, direction, page, term, filters, reload, source, sourceEnabled]);

  function toggleSort(key: string) {
    if (sort === key) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDirection("asc");
    }
    setPage(1);
  }

  const records = data?.records ?? [];
  const exportUrl = (() => {
    const params = new URLSearchParams({ object: object.slug, sort, direction, columns: columns.map((c) => c.slug).join(",") });
    if (term) params.set("q", term);
    if (sourceEnabled && source !== "all") params.set("source", source);
    for (const f of filters) params.append("filter", `${f.attribute}:${f.op}${f.value ? `:${f.value}` : ""}`);
    return `/api/data/export?${params}`;
  })();
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSelected = records.length > 0 && records.every((r) => selected.has(r.id));
  const isCompanies = object.slug === "companies";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-bold tracking-tight text-[var(--color-text)]">
          {object.plural_name}
          <span className="ml-2 text-[13px] font-medium tabular-nums text-[var(--color-text-faint)]">
            {loading && !data ? "" : total.toLocaleString("en-IN")}
          </span>
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-copper)]" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${object.plural_name.toLowerCase()}…`}
              aria-label={`Search ${object.plural_name.toLowerCase()}`}
              className="input-field h-9 w-[220px] pl-8 text-[12.5px]"
            />
          </div>
          <a href={exportUrl} download className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]" title="Download what this table shows as a CSV file">
            <Download className="h-3.5 w-3.5" /> Export
          </a>
          {canWrite && (
            <button type="button" onClick={() => setImporting(true)} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]">
              <Upload className="h-3.5 w-3.5" /> Import
            </button>
          )}
          <ColumnPicker attributes={visibleAttributes} selected={columns.map((c) => c.slug)} onChange={(slugs) => setColumnSlugs(slugs)} />
          {isAdmin && (
            <button type="button" onClick={() => setFieldsOpen(true)} className="btn-ghost h-9 gap-1.5 px-3 text-[12.5px]">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Fields
            </button>
          )}
          {isAdmin && (
            <button type="button" onClick={() => setRulesOpen(true)} className="btn-ghost h-9 gap-1.5 px-3 text-[12.5px]">
              <ShieldCheck className="h-3.5 w-3.5" /> Rules
            </button>
          )}
          {canWrite && (
            <button type="button" onClick={() => setCreating(true)} className="btn-primary-copper h-9 gap-1.5 px-3 text-[12.5px]">
              <Plus className="h-3.5 w-3.5" /> New {object.singular_name.toLowerCase()}
            </button>
          )}
        </div>
      </div>

      <ViewBar
        objectSlug={object.slug}
        defaultLabel={`All ${object.plural_name.toLowerCase()}`}
        isAdmin={isAdmin}
        current={{ columns: columnSlugs ?? undefined, filters, sort, direction, widths }}
        onApply={applyView}
      />

      {sourceEnabled && (
        <SimpleDropdown
          label="Source"
          value={source}
          options={object.slug === "companies" ? COMPANY_SOURCE_OPTIONS : SOURCE_OPTIONS}
          onChange={(v) => {
            setSource(v);
            setPage(1);
          }}
        />
      )}

      <FilterBar
        attributes={object.attributes.filter((a) => !a.archived_at && a.type !== "long_text")}
        filters={filters}
        members={members}
        userId={userId}
        onChange={(f) => {
          setFilters(f);
          setPage(1);
        }}
      />

      {selected.size > 0 && (
        <BulkBar objectSlug={object.slug} ids={[...selected]} canWrite={canWrite} onClear={() => setSelected(new Set())} />
      )}

      {error && <p role="alert" className="text-[13px] text-[var(--color-danger)]">{error}</p>}

      <div className="card relative overflow-auto" style={{ maxHeight: "calc(100vh - 290px)" }}>
        <table
          className="border-separate border-spacing-0 text-left text-[13px]"
          style={{ tableLayout: "fixed", minWidth: "100%", width: 36 + widthOf("name") + columns.reduce((t, c) => t + widthOf(c.slug), 0) + 40 }}
        >
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: widthOf("name") }} />
            {columns.map((c) => (
              <col key={c.slug} style={{ width: widthOf(c.slug) }} />
            ))}
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="sticky top-0 z-10 w-9 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(records.map((r) => r.id)) : new Set())}
                />
              </th>
              <Th label="Name" type="text" active={sort === "name"} direction={direction} onClick={() => toggleSort("name")} width={widthOf("name")} onResize={(w) => setWidth("name", w)} onReset={() => resetWidth("name")} />
              {columns.map((c) => (
                <Th key={c.slug} label={c.name} type={c.type} active={sort === c.slug} direction={direction} onClick={() => toggleSort(c.slug)} width={widthOf(c.slug)} onResize={(w) => setWidth(c.slug, w)} onReset={() => resetWidth(c.slug)} />
              ))}
              <th scope="col" className="sticky top-0 z-10 w-10 border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-2">
                {isAdmin && (
                  <button type="button" aria-label="Add a field" title="Add a field" onClick={() => setFieldsOpen(true)} className="rounded p-1 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {records.map((rec) => (
              <tr
                key={rec.id}
                tabIndex={0}
                onClick={canWrite ? undefined : () => router.push(`/data/${rec.id}`)}
                onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && router.push(`/data/${rec.id}`)}
                className={cn("group focus:outline-none", !canWrite && "cursor-pointer", selected.has(rec.id) ? "bg-[var(--color-primary-tint)]" : "hover:bg-[var(--color-surface-2)] focus:bg-[var(--color-surface-2)]")}
              >
                <td className="border-b border-[var(--color-border)] px-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${rec.name || "record"}`}
                    checked={selected.has(rec.id)}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(rec.id);
                        else next.delete(rec.id);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="overflow-hidden border-b border-[var(--color-border)] px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <RecordAvatar name={rec.name} seed={rec.id} size={22} square={isCompanies} />
                    <Link href={`/data/${rec.id}`} className="truncate font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>
                      {rec.name || "Unnamed"}
                    </Link>
                  </span>
                </td>
                {columns.map((c) => (
                  <td
                    key={c.slug}
                    onClick={canWrite && c.type !== "checkbox" && !(editing?.id === rec.id && editing.slug === c.slug) ? () => setEditing({ id: rec.id, slug: c.slug }) : undefined}
                    className={cn("overflow-hidden border-b border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text-muted)]", canWrite && c.type !== "checkbox" && "cursor-text hover:bg-[var(--color-surface-offset)]")}
                  >
                    {editing?.id === rec.id && editing.slug === c.slug ? (
                      <CellEditor
                        attr={c}
                        rec={rec}
                        onCancel={() => setEditing(null)}
                        onSaved={(updated) => {
                          setEditing(null);
                          clearDataCache();
                          setData((d) => (d ? { ...d, records: d.records.map((r) => (r.id === updated.id ? updated : r)) } : d));
                          if (c.type === "record_ref") setReload((n) => n + 1);
                        }}
                      />
                    ) : c.type === "checkbox" && canWrite ? (
                      <input
                        type="checkbox"
                        aria-label={`${c.name} for ${rec.name}`}
                        checked={rec.values[c.slug] === true}
                        onChange={async (e) => {
                          const r = await dataApi<{ record: RecordRow }>(`/api/data/records/${rec.id}`, { method: "PATCH", body: { values: { [c.slug]: e.target.checked ? true : null } } });
                          if (r.ok) {
                            clearDataCache();
                            setData((d) => (d ? { ...d, records: d.records.map((x) => (x.id === rec.id ? r.data.record : x)) } : d));
                          }
                          else setError(r.error);
                        }}
                      />
                    ) : (
                      <Cell attr={c} rec={rec} refNames={refNames} />
                    )}
                  </td>
                ))}
                <td className="border-b border-[var(--color-border)]" />
              </tr>
            ))}
            {data && records.length === 0 && !loading && (
              <tr>
                <td colSpan={columns.length + 3} className="px-3 py-10 text-center text-[var(--color-text-muted)]">
                  {term || filters.length ? (
                    "Nothing matches."
                  ) : (
                    <div className="space-y-2">
                      <p>No {object.plural_name.toLowerCase()} yet.</p>
                      {isAdmin && object.slug === "people" && <SetupPanel hasObjects onDone={onSetup} />}
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {loading && (
          <div className="pointer-events-none absolute right-3 top-10 text-[var(--color-text-faint)]">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-[12.5px] text-[var(--color-text-muted)]">
        <span>{total.toLocaleString("en-IN")} {total === 1 ? object.singular_name.toLowerCase() : object.plural_name.toLowerCase()}</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <span>Page {page} of {pages.toLocaleString("en-IN")}</span>
            <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost h-8 w-8 p-0 disabled:opacity-40">
              <ChevronLeft className="mx-auto h-4 w-4" />
            </button>
            <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="btn-ghost h-8 w-8 p-0 disabled:opacity-40">
              <ChevronRight className="mx-auto h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {fieldsOpen && (
        <AttributesModal
          title={`${object.singular_name} fields`}
          base={`/api/data/objects/${object.slug}`}
          attributes={object.attributes}
          objects={objects}
          names={{ singular: object.singular_name, plural: object.plural_name }}
          staffAccess={object.staff_access ?? "write"}
          highlights={object.highlights ?? []}
          objectSlug={object.slug}
          isSystemObject={object.is_system}
          onChanged={onSetup}
          onClose={() => setFieldsOpen(false)}
        />
      )}
      {rulesOpen && <RulesModal mode="record" objectSlug={object.slug} title={`Rules for ${object.plural_name.toLowerCase()}`} attributes={object.attributes} onClose={() => setRulesOpen(false)} />}
      {importing && (
        <ImportModal objectSlug={object.slug} objectName={object.plural_name} attributes={object.attributes} onDone={() => {
            clearDataCache();
            setReload((n) => n + 1);
          }} onClose={() => setImporting(false)} />
      )}
      {creating && <NewRecordModal object={object} onClose={() => setCreating(false)} onCreated={(rec) => router.push(`/data/${rec.id}`)} />}
    </div>
  );
}

function Th({
  label,
  type,
  active,
  direction,
  onClick,
  width,
  onResize,
  onReset,
}: {
  label: string;
  type: AttributeDef["type"];
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
}) {
  // Drag the right edge to resize; arrow keys do the same from the keyboard; double-click resets.
  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = width;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => onResize(startWidth + (ev.clientX - startX));
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  return (
    <th scope="col" aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"} className="sticky top-0 z-10 overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 font-semibold">
      <button type="button" onClick={onClick} className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <TypeIcon type={type} className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
        <span className="truncate">{label}</span>
        {active && (direction === "asc" ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />)}
      </button>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label} column`}
        aria-valuemin={MIN_COLUMN_WIDTH}
        aria-valuemax={MAX_COLUMN_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={startDrag}
        onDoubleClick={onReset}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onResize(width - 10);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            onResize(width + 10);
          }
        }}
        className="absolute right-0 top-0 z-20 h-full w-2 cursor-col-resize touch-none select-none after:absolute after:right-0 after:top-1/4 after:h-1/2 after:w-px after:bg-[var(--color-border-strong)] hover:after:w-0.5 hover:after:bg-[var(--color-copper)] focus-visible:after:w-0.5 focus-visible:after:bg-[var(--color-copper)] focus-visible:outline-none"
      />
    </th>
  );
}

const chip = "inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--color-surface-offset)] px-1.5 py-0.5 text-[12px] font-medium text-[var(--color-text)]";

/** One cell. References and options read as chips; everything else as plain text. */
function Cell({ attr, rec, refNames }: { attr: AttributeDef; rec: RecordRow; refNames: Record<string, string> }) {
  const v = rec.values[attr.slug];
  if (v === undefined || v === null) return null;

  if (attr.type === "record_ref" || attr.type === "member") {
    const name = typeof v === "string" ? refNames[v] : undefined;
    if (!name) return <span className="text-[var(--color-text-faint)]">…</span>;
    return (
      <span className={chip}>
        <RecordAvatar name={name} seed={String(v)} size={16} square={attr.type === "record_ref"} />
        <span className="truncate">{name}</span>
      </span>
    );
  }
  if (attr.type === "select" || attr.type === "multi_select") {
    const items = Array.isArray(v) ? v : [v];
    return (
      <span className="flex gap-1 overflow-hidden">
        {items.map((i) => (
          <span key={String(i)} className={chip}>{String(i)}</span>
        ))}
      </span>
    );
  }
  if (attr.type === "checkbox") return <span>{v ? "✓" : ""}</span>;
  return <span className="block truncate">{formatValue(attr, v)}</span>;
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

function BulkBar({ objectSlug, ids, canWrite, onClear }: { objectSlug: string; ids: string[]; canWrite: boolean; onClear: () => void }) {
  const [lists, setLists] = useState<{ id: string; name: string }[]>([]);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void dataApi<{ lists: { id: string; name: string }[] }>(`/api/data/lists?object=${objectSlug}`).then((r) => r.ok && setLists(r.data.lists));
  }, [objectSlug]);

  async function addAll() {
    setBusy(true);
    setMessage(null);
    let added = 0;
    let already = 0;
    let failed = 0;
    for (const recordId of ids) {
      const r = await dataApi(`/api/data/lists/${choice}/entries`, { method: "POST", body: { recordId } });
      if (r.ok) added++;
      else if (r.status === 409) already++;
      else failed++;
    }
    setBusy(false);
    setMessage(`Added ${added}${already ? `, ${already} already on the list` : ""}${failed ? `, ${failed} failed` : ""}.`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-[13px]" role="region" aria-label="Selected records">
      <span className="font-semibold">{ids.length} selected</span>
      {canWrite && lists.length > 0 && (
        <>
          <select aria-label="List" value={choice} onChange={(e) => setChoice(e.target.value)} className="input-field select-chevron h-8 w-[200px] text-[12.5px]">
            <option value="">Add to a list…</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <button type="button" disabled={!choice || busy} onClick={() => void addAll()} className="btn-primary-copper inline-flex h-8 items-center gap-1.5 px-3 text-[12.5px]">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Add
          </button>
        </>
      )}
      {message && <span role="status" className="text-[var(--color-text-muted)]">{message}</span>}
      <button type="button" onClick={onClear} className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <X className="h-3.5 w-3.5" /> Clear
      </button>
    </div>
  );
}

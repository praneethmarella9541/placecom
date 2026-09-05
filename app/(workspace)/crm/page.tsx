"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, RefreshCw, Search, Settings2, Sparkles, UserPlus, Users2 } from "lucide-react";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";
import { CRM_MODELS, DEFAULT_CRM_SETTINGS, type CrmSettings } from "@/lib/crm-settings";
import type { CrmStage } from "@/lib/crm-stages-types";
import { CrmStageManager } from "@/components/CrmStageManager";
import { CrmImportContactsModal } from "@/components/CrmImportContactsModal";
import { CrmLeadModal, type CrmLead } from "@/components/CrmLeadModal";
import { GmailDatePicker } from "@/components/GmailDatePicker";

type LeadRow = CrmLead;

type RunSummary = {
  classified: number;
  parked: number;
  costUsd: number;
  model: string;
  mailIncluded: boolean;
};

/**
 * The board is built from stages the user defines (crm_stages), and leads only
 * enter it by being added explicitly from the contact book. Classification
 * runs on add and on the re-classify button — never on a timer — so OpenAI
 * spend is bounded by deliberate actions and reported per run.
 */
export default function CRMPage() {
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [settings, setSettings] = useState<CrmSettings>(DEFAULT_CRM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null);
  const [draggingLeadId, setDraggingLeadId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const boardScrollRef = useRef<HTMLDivElement>(null);

  // Only a genuinely horizontal gesture (trackpad sideways swipe, or a mouse's
  // horizontal wheel/tilt-scroll — deltaX dominant) drives the board's
  // scrollLeft ourselves; a vertical swipe or plain wheel (deltaY dominant) is
  // left untouched so it doesn't get hijacked into moving the board
  // sideways. We still drive the horizontal case explicitly rather than
  // trusting native scrolling, since macOS's swipe-to-navigate can hijack an
  // unhandled horizontal gesture at the scroll edges. Attached as a real DOM
  // listener with { passive: false }, not React's onWheel, so preventDefault
  // actually takes effect.
  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (el!.scrollWidth <= el!.clientWidth) return;
      e.preventDefault();
      el!.scrollLeft += e.deltaX;
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stagesRes, settingsRes, leadsRes] = await Promise.all([
        fetch("/api/crm/stages"),
        fetch("/api/crm/settings"),
        fetch("/api/crm/leads"),
      ]);

      const stagesJson = await stagesRes.json().catch(() => ({}));
      if (!stagesRes.ok) throw new Error(stagesJson.error || "Failed to load board");
      setStages(stagesJson.stages ?? []);

      const settingsJson = await settingsRes.json().catch(() => ({}));
      if (settingsRes.ok) setSettings(settingsJson.settings ?? DEFAULT_CRM_SETTINGS);

      const leadsJson = await leadsRes.json().catch(() => ({}));
      if (leadsRes.ok) setLeads(leadsJson.leads ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Global, not per-column — searching "Acme" should surface that lead
  // wherever it currently sits, without having to know which column to look
  // in first. Board layout (which columns exist) is untouched by a search;
  // only which cards render inside them changes.
  const searchedLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      [l.company_name, l.contact_name, l.email]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [leads, search]);

  const byStage = useMemo(() => {
    const map = new Map<string, LeadRow[]>();
    const unsortedId = stages.find((s) => s.is_unsorted)?.id ?? null;
    for (const lead of searchedLeads) {
      // A lead with no stage at all (imported before the board had columns)
      // still has to be reachable — show it in the unsorted column.
      const key = lead.stage_id ?? unsortedId;
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(lead);
      map.set(key, list);
    }
    return map;
  }, [searchedLeads, stages]);

  // Board and empty state are mutually exclusive and together always cover the
  // non-loading case — gating them on separate conditions once left a blank
  // page when the columns themselves failed to load. Keyed off the
  // unfiltered list: an empty *search result* gets its own message below,
  // not this "add your first lead" state.
  const showEmptyState = !loading && stages.length > 0 && leads.length === 0;
  const showNoSearchResults = !loading && !showEmptyState && search.trim() !== "" && searchedLeads.length === 0;

  // Resolved from the list rather than held as its own copy, so the open modal
  // reflects a re-classify or a stage move without needing its own refetch.
  const activeLead = useMemo(
    () => leads.find((l) => l.id === activeLeadId) ?? null,
    [leads, activeLeadId]
  );

  // What the import picker must not offer again. Matched two ways: by the
  // originating contact row, and by email for leads created before
  // source_contact_id existed (or added by hand on the old board).
  const existingContactIds = useMemo(
    () =>
      new Set(
        leads.map((l) => l.source_contact_id).filter((id): id is string => Boolean(id))
      ),
    [leads]
  );
  const existingLeadEmails = useMemo(
    () =>
      new Set(
        leads
          .map((l) => l.email?.trim().toLowerCase())
          .filter((e): e is string => Boolean(e))
      ),
    [leads]
  );

  async function patchSettings(patch: Partial<CrmSettings>) {
    setError(null);
    setSettings((prev) => ({ ...prev, ...patch }));
    try {
      const res = await fetch("/api/crm/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to save");
      setSettings(json.settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
      void load();
    }
  }

  async function classify(leadIds?: string[], force = false) {
    setClassifying(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds, force }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Classification failed");
      setLastRun({
        classified: json.classified ?? 0,
        parked: json.parked ?? 0,
        costUsd: json.costUsd ?? 0,
        model: json.model ?? settings.model,
        mailIncluded: json.mailIncluded !== false,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Classification failed");
    } finally {
      setClassifying(false);
    }
  }

  async function moveLead(leadId: string, stageId: string) {
    // Optimistic, and marked human so a later re-classify leaves it alone.
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stage_id: stageId, stage_set_by: "human" } : l))
    );
    try {
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: stageId, stage_set_by: "human" }),
      });
      if (!res.ok) throw new Error("Failed to move lead");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move lead");
      void load();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-[17px] font-bold text-[var(--color-text)]">
            {titleCase("CRM")}
          </h1>
          {/* Season and model are configuration, not daily actions — they read
              as context under the title rather than competing with Import for
              space in the action bar, where they used to push the primary
              button around and wrap badly. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--color-text-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
              {titleCase("Season from")}
              <GmailDatePicker
                value={settings.season_start_date ?? ""}
                onChange={(v) => void patchSettings({ season_start_date: v || null })}
                // Sized to the "YYYY/MM/DD" field itself — the dropdown
                // calendar has its own fixed width now (GmailDatePicker.tsx),
                // independent of this trigger, so this no longer has to be
                // stretched wide just to give the calendar room.
                className="w-[136px]"
                placeholder={titleCase("Pick a date")}
              />
            </span>
            <span className="text-[var(--color-text-faint)]">·</span>
            <label className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" />
              <span className="sr-only">{titleCase("Classifier model")}</span>
              <select
                value={settings.model}
                onChange={(e) => void patchSettings({ model: e.target.value })}
                className="cursor-pointer rounded bg-transparent text-[12px] font-semibold text-[var(--color-text)] outline-none hover:underline"
              >
                {CRM_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={titleCase("Search leads…")}
              aria-label={titleCase("Search leads")}
              className="input-field h-9 w-[180px] pl-8 text-[12.5px]"
            />
          </div>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="btn-primary-copper h-9 gap-1.5 px-3 text-[12.5px]"
          >
            <UserPlus className="h-4 w-4" />
            {titleCase("Import from contacts")}
          </button>
          <button
            type="button"
            disabled={classifying || leads.length === 0}
            onClick={() => void classify(undefined, true)}
            title={titleCase("Re-run the classifier over every lead, including ones you moved by hand")}
            className="btn-secondary h-9 gap-1.5 px-3 text-[12.5px] disabled:opacity-50"
          >
            <Sparkles className={`h-4 w-4 ${classifying ? "animate-pulse" : ""}`} />
            {classifying ? titleCase("Classifying…") : titleCase("Re-classify")}
          </button>
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="btn-ghost h-9 gap-1.5 px-3 text-[12.5px]"
          >
            <Settings2 className="h-4 w-4" />
            {titleCase("Columns")}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="btn-ghost h-9 w-9 justify-center p-0 disabled:opacity-50"
            title={titleCase("Refresh")}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!settings.season_start_date && !loading && (
        <div className="rounded-xl border border-[var(--color-copper)]/30 bg-[var(--color-copper-tint)] px-4 py-3 text-[12.5px] text-[var(--color-text)]">
          {titleCase(
            "Set a season start date — the classifier only reads mail and WhatsApp from on or after it."
          )}
        </div>
      )}

      {lastRun && (
        <div className="surface-card flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--radius-md)] px-4 py-2.5 text-[12px] text-[var(--color-text-muted)]">
          <span>
            {titleCase("Last run")}:{" "}
            <strong className="text-[var(--color-text)]">{lastRun.classified}</strong>{" "}
            {titleCase("placed")}, <strong className="text-[var(--color-text)]">{lastRun.parked}</strong>{" "}
            {titleCase("parked for review")}
          </span>
          <span>
            {titleCase("Cost")}:{" "}
            <strong className="text-[var(--color-text)]">${lastRun.costUsd.toFixed(4)}</strong> (
            {lastRun.model})
          </span>
          {!lastRun.mailIncluded && (
            <span className="text-[var(--color-warning)]">
              {titleCase("Mail was unavailable — classified on WhatsApp and notes only.")}
            </span>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger-light)] px-4 py-3 text-[13px] text-[var(--color-danger)]"
        >
          {error}
        </div>
      )}

      {/* One board-level empty state instead of a wall of identical "No leads"
          boxes, one per column — on a fresh board that told the user nothing
          about what to do next. */}
      {showEmptyState && (
        <div className="surface-card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
          <Users2 className="h-7 w-7 text-[var(--color-text-faint)]" strokeWidth={1.5} />
          <p className="text-[14px] font-semibold text-[var(--color-text)]">
            {titleCase("No leads on the board yet")}
          </p>
          <p className="max-w-sm text-[13px] leading-relaxed text-[var(--color-text-muted)]">
            {titleCase(
              "Pick people from your contact book — the classifier reads your mail and WhatsApp with them and files each one into a column."
            )}
          </p>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="btn-primary-copper mt-1 h-9 gap-1.5 px-4 text-[12.5px]"
          >
            <UserPlus className="h-4 w-4" />
            {titleCase("Import from contacts")}
          </button>
        </div>
      )}

      {showNoSearchResults && (
        <div className="surface-card flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <Search className="h-6 w-6 text-[var(--color-text-faint)]" strokeWidth={1.5} />
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {titleCase(`No leads match "${search.trim()}".`)}
          </p>
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-[12.5px] font-semibold text-[var(--color-copper)] hover:underline"
          >
            {titleCase("Clear search")}
          </button>
        </div>
      )}

      <div
        ref={boardScrollRef}
        className={cn("min-w-0 overflow-x-auto pb-4", (showEmptyState || showNoSearchResults) && "hidden")}
      >
        <div className="flex w-max min-w-full gap-4">
          {loading
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="w-[260px] shrink-0">
                  <div className="skeleton-shimmer h-[46px] rounded-t-[var(--radius-lg)]" />
                  <div className="skeleton-shimmer mt-1 h-[300px] rounded-b-[var(--radius-lg)]" />
                </div>
              ))
            : stages.map((stage) => {
                const stageLeads = byStage.get(stage.id) ?? [];
                const isDropTarget = dragOverStageId === stage.id;
                return (
                  <div
                    key={stage.id}
                    data-testid={`crm-stage-column-${stage.id}`}
                    className="flex w-[280px] shrink-0 flex-col"
                    onDragOver={(e) => {
                      if (!draggingLeadId) return;
                      e.preventDefault(); // required for onDrop to fire
                      setDragOverStageId(stage.id);
                    }}
                    onDragLeave={(e) => {
                      // Ignore bubbling from children, or the highlight flickers
                      // as the pointer crosses each card inside the column.
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                      setDragOverStageId((cur) => (cur === stage.id ? null : cur));
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const leadId = e.dataTransfer.getData("text/plain") || draggingLeadId;
                      setDragOverStageId(null);
                      setDraggingLeadId(null);
                      if (leadId) void moveLead(leadId, stage.id);
                    }}
                  >
                    <div
                      className={cn(
                        "surface-card rounded-b-none border-b-0 border-l-4 px-4 py-3 transition-colors",
                        isDropTarget && "bg-[var(--color-copper-tint)]"
                      )}
                      style={{ borderLeftColor: stage.color ?? "var(--color-border)" }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="truncate text-[13px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                          {stage.name}
                        </h3>
                        <span className="rounded-full bg-[var(--color-surface-offset)] px-2 py-0.5 text-[12px] font-semibold text-[var(--color-text)]">
                          {stageLeads.length}
                        </span>
                      </div>
                      {stage.description && (
                        <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-[var(--color-text-faint)]">
                          {stage.description}
                        </p>
                      )}
                    </div>
                    {/* Each column scrolls on its own: one oversized column
                        (Unsorted, typically) used to stretch the whole page and
                        push every other column's contents out of view. */}
                    <div
                      className={cn(
                        // Explicit min-height (not the flex default `auto`) is
                        // what actually stops this from growing past max-height —
                        // a flex item's automatic minimum is content-sized unless
                        // overridden, which is what let one full column stretch
                        // the whole row. overscroll-contain keeps scrolling past
                        // the end of a column's list from also scrolling the page.
                        "surface-card flex max-h-[640px] min-h-[300px] flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain rounded-t-none border-t-0 bg-[var(--color-surface-offset)] p-3 shadow-none transition-colors",
                        isDropTarget && "bg-[var(--color-copper-tint)] ring-1 ring-inset ring-[var(--color-copper)]/40"
                      )}
                    >
                      {stageLeads.map((lead) => (
                        <div
                          key={lead.id}
                          data-testid={`crm-lead-card-${lead.id}`}
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", lead.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDraggingLeadId(lead.id);
                          }}
                          onDragEnd={() => {
                            setDraggingLeadId(null);
                            setDragOverStageId(null);
                          }}
                          onClick={() => setActiveLeadId(lead.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setActiveLeadId(lead.id);
                            }
                          }}
                          className={cn(
                            "surface-card cursor-grab p-3 transition-all duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-md)] active:cursor-grabbing",
                            draggingLeadId === lead.id && "opacity-40"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="min-w-0 flex-1 truncate text-[13.5px] font-bold text-[var(--color-text)]">
                              {lead.company_name}
                            </h4>
                            {lead.stage_set_by === "ai" && lead.ai_confidence !== null && (
                              <span className="shrink-0 rounded-full bg-[var(--color-copper-tint)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--color-copper)]">
                                AI {Math.round(lead.ai_confidence * 100)}%
                              </span>
                            )}
                          </div>
                          {lead.contact_name && (
                            <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">
                              {lead.contact_name}
                            </p>
                          )}
                        </div>
                      ))}
                      {stageLeads.length === 0 && (
                        <div className="flex flex-1 flex-col items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-[var(--color-border)] py-8 text-center">
                          <p className="px-3 text-[12px] text-[var(--color-text-faint)]">
                            {titleCase(draggingLeadId ? "Drop here" : "Nothing here")}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
        </div>
      </div>

      {managerOpen && (
        <CrmStageManager
          stages={stages}
          onClose={() => setManagerOpen(false)}
          onChanged={setStages}
        />
      )}

      {activeLead && (
        <CrmLeadModal
          lead={activeLead}
          stages={stages}
          onClose={() => setActiveLeadId(null)}
          onReclassify={(leadId) => {
            setActiveLeadId(null);
            void classify([leadId], true);
          }}
          onMove={(leadId, stageId) => void moveLead(leadId, stageId)}
        />
      )}

      {importOpen && (
        <CrmImportContactsModal
          existingContactIds={existingContactIds}
          existingEmails={existingLeadEmails}
          onClose={() => setImportOpen(false)}
          onImported={(leadIds) => {
            void load();
            // Classify exactly what was just added — the whole point of the
            // import returning ids rather than re-running the whole board.
            if (leadIds.length > 0) void classify(leadIds);
          }}
        />
      )}
    </div>
  );
}

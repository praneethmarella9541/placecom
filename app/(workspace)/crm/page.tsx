"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { UserPlus, ChevronRight, Users2, RefreshCw } from "lucide-react";
import { IconPhone, IconMail, IconMenu, IconX, IconCalendar, IconUser } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";
import { CONNECTION_STRENGTH_DOT } from "@/lib/connection-strength-ui";
import type { EmailConnectionStrength } from "@/lib/email-connection-strength";

type LeadScore = "Hot" | "Warm" | "Cold";
type LeadType = "New Lead" | "Regular Recruiter";
type LeadStage = "Awareness" | "Engagement" | "Conversion" | "Retention" | "Relationship Mgt" | "JD Expected" | "JD Received" | "Drive Scheduled";

type LeadRow = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  stage: LeadStage;
  score: LeadScore;
  staff_name: string;
  lead_type: LeadType;
  jd_count: number;
  stage_updated_at: string;
  last_interaction_at: string;
  created_at: string;
  email_last_interaction_at: string | null;
  email_connection_strength: EmailConnectionStrength | null;
};

type InteractionRow = {
  id: string;
  interaction_type: "Call" | "Email" | "Meeting" | "Note";
  notes: string | null;
  created_at: string;
};

type MeetingRow = {
  id: string;
  meeting_url: string;
  status: string;
  transcript: string | null;
  summary: string | null;
  created_at: string;
};

const NEW_LEAD_STAGES: LeadStage[] = ["Awareness", "Engagement", "Conversion", "Retention"];
const REG_RECRUITER_STAGES: LeadStage[] = ["Relationship Mgt", "JD Expected", "JD Received", "Drive Scheduled"];

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}


function stageColumnBorder(stage: LeadStage, funnel: LeadType): string {
  if (funnel === "New Lead") {
    if (stage === "Awareness") return "border-l-[var(--color-blue)]";
    if (stage === "Engagement") return "border-l-[var(--color-gold)]";
    if (stage === "Conversion") return "border-l-[var(--color-success)]";
    if (stage === "Retention") return "border-l-[var(--color-primary)]";
  }
  const i = REG_RECRUITER_STAGES.indexOf(stage);
  const c = [
    "border-l-[var(--color-blue)]",
    "border-l-[var(--color-gold)]",
    "border-l-[var(--color-success)]",
    "border-l-[var(--color-primary)]",
  ];
  return c[Math.max(0, i) % 4] ?? "border-l-[var(--color-border)]";
}

function daysInStage(lead: LeadRow): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(lead.stage_updated_at).getTime()) / (1000 * 60 * 60 * 24)),
  );
}

export default function CRMPage() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Funnel
  const [activeFunnel, setActiveFunnel] = useState<LeadType>("New Lead");
  const CURRENT_STAGES = activeFunnel === "New Lead" ? NEW_LEAD_STAGES : REG_RECRUITER_STAGES;

  // Filters
  const [staffFilter, setStaffFilter] = useState<string>("All");
  const [stalledOnly, setStalledOnly] = useState<boolean>(false);

  // Modals
  const [isAddLeadOpen, setIsAddLeadOpen] = useState(false);
  const [activeLead, setActiveLead] = useState<LeadRow | null>(null);

  // Add Lead Form
  const [newCompany, setNewCompany] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newStaff, setNewStaff] = useState("");
  const [newScore, setNewScore] = useState<LeadScore>("Warm");
  const [newLeadType, setNewLeadType] = useState<LeadType>("New Lead");

  // Interaction Form
  const [interactions, setInteractions] = useState<InteractionRow[]>([]);
  const [meetings, setMeetings] = useState<MeetingRow[]>([]);
  const [loadingInteractions, setLoadingInteractions] = useState(false);
  const [interactionType, setInteractionType] = useState<InteractionRow["interaction_type"]>("Note");
  const [interactionNotes, setInteractionNotes] = useState("");
  const [activePanelTab, setActivePanelTab] = useState<"History" | "Meetings">("History");
  const [emailConnection, setEmailConnection] = useState<{
    lastInteractionAt: string | null;
    connectionStrength: EmailConnectionStrength;
  } | null>(null);
  const [loadingEmailConnection, setLoadingEmailConnection] = useState(false);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/leads");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load leads");
      }
      const json = await res.json();
      setLeads(json.leads || []);
    } catch (e: unknown) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeads();
  }, [loadLeads]);

  // Close open modal / slide-over on Escape.
  useEffect(() => {
    if (!isAddLeadOpen && !activeLead) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsAddLeadOpen(false);
        setActiveLead(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isAddLeadOpen, activeLead]);

  const allStaffNames = useMemo(() => {
    const names = new Set(leads.map(l => l.staff_name));
    return Array.from(names).sort();
  }, [leads]);

  const filteredLeads = useMemo(() => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    return leads.filter(l => {
      if (l.lead_type !== activeFunnel) return false;
      if (staffFilter !== "All" && l.staff_name !== staffFilter) return false;
      if (stalledOnly && new Date(l.last_interaction_at) > threeDaysAgo) return false;
      return true;
    });
  }, [leads, staffFilter, stalledOnly, activeFunnel]);

  const leadVelocity = useMemo(() => {
    const engagementLeads = filteredLeads.filter(l => l.stage === "Engagement" || l.stage === "JD Expected");
    if (engagementLeads.length === 0) return 0;
    const totalDays = engagementLeads.reduce((acc, l) => {
      const daysInStage = (Date.now() - new Date(l.stage_updated_at).getTime()) / (1000 * 60 * 60 * 24);
      return acc + daysInStage;
    }, 0);
    return Math.round((totalDays / engagementLeads.length) * 10) / 10;
  }, [filteredLeads]);

  async function handleAddLead(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: newCompany,
          contact_name: newContact,
          email: newEmail,
          phone: newPhone,
          score: newScore,
          staff_name: newStaff || "Unassigned",
          lead_type: newLeadType,
          stage: newLeadType === "Regular Recruiter" ? "Relationship Mgt" : "Awareness"
        })
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to add lead");
      }
      setIsAddLeadOpen(false);
      setNewCompany("");
      setNewContact("");
      setNewEmail("");
      setNewPhone("");
      setNewScore("Warm");
      await loadLeads();
    } catch (err: unknown) {
      alert(errMessage(err));
    }
  }

  async function handleUpdateLeadStage(leadId: string, newStage: LeadStage) {
    try {
      // Optimistic update
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage: newStage, stage_updated_at: new Date().toISOString() } : l));
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage })
      });
      if (!res.ok) throw new Error("Failed to update stage");
    } catch (err: unknown) {
      alert(errMessage(err));
      void loadLeads(); // Revert on failure
    }
  }

  async function handleUpdateJDCount(leadId: string, newCount: number) {
    if (newCount < 0) return;
    try {
      // Optimistic update
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, jd_count: newCount } : l));
      const res = await fetch(`/api/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd_count: newCount })
      });
      if (!res.ok) throw new Error("Failed to update JD count");
    } catch (err: unknown) {
      alert(errMessage(err));
      void loadLeads();
    }
  }

  async function loadInteractions(lead: LeadRow) {
    setLoadingInteractions(true);
    try {
      // 1. Fetch Interactions
      const res = await fetch(`/api/crm/interactions?leadId=${lead.id}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load interactions");
      }
      const json = await res.json();
      setInteractions(json.interactions || []);

      // 2. Fetch GMeet Summaries via email
      if (lead.email) {
        const meetRes = await fetch(`/api/crm/meetings?email=${encodeURIComponent(lead.email)}`);
        if (meetRes.ok) {
          const meetJson = await meetRes.json();
          setMeetings(meetJson.meetings || []);
        }
      } else {
        setMeetings([]);
      }
    } catch (err: unknown) {
      alert(errMessage(err));
    } finally {
      setLoadingInteractions(false);
    }
  }

  async function loadEmailConnection(lead: LeadRow, force = false) {
    if (!lead.email) {
      setEmailConnection(null);
      return;
    }
    setLoadingEmailConnection(true);
    try {
      const res = await fetch(
        `/api/crm/leads/${lead.id}/email-connection${force ? "?force=1" : ""}`
      );
      if (!res.ok) {
        setEmailConnection(null);
        return;
      }
      const json = await res.json();
      setEmailConnection({
        lastInteractionAt: json.lastInteractionAt ?? null,
        connectionStrength: json.connectionStrength,
      });
    } catch {
      setEmailConnection(null);
    } finally {
      setLoadingEmailConnection(false);
    }
  }

  async function handleAddInteraction(e: React.FormEvent) {
    e.preventDefault();
    if (!activeLead) return;
    try {
      const res = await fetch("/api/crm/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: activeLead.id,
          interaction_type: interactionType,
          notes: interactionNotes
        })
      });
      if (!res.ok) throw new Error("Failed to add interaction");
      setInteractionNotes("");
      await loadInteractions(activeLead);
      void loadLeads(); // Refresh last_interaction_at
    } catch (err: unknown) {
      alert(errMessage(err));
    }
  }

  return (
    <>
      <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <h1 className="font-display text-[17px] font-bold text-[var(--color-text)]">
            {titleCase("Marketing Funnel CRM")}
          </h1>
          <div className="flex items-center gap-0.5 rounded-[var(--radius-md)] bg-[var(--color-surface-offset)] p-0.5">
            <button
              data-testid="crm-funnel-new-lead"
              type="button"
              onClick={() => setActiveFunnel("New Lead")}
              className={`rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                activeFunnel === "New Lead"
                  ? "bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {titleCase("New Leads Pipeline")}
            </button>
            <button
              data-testid="crm-funnel-regular-recruiter"
              type="button"
              onClick={() => setActiveFunnel("Regular Recruiter")}
              className={`rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                activeFunnel === "Regular Recruiter"
                  ? "bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {titleCase("Regular Recruiters")}
            </button>
            <Link
              data-testid="crm-funnel-companies"
              href="/crm/companies"
              className="rounded-[var(--radius-md)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
            >
              {titleCase("Companies")}
            </Link>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            data-testid="crm-staff-filter"
            className="input-field h-[34px] min-w-[160px] text-[13px]"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
          >
            <option value="All">{titleCase("All staff")}</option>
            {allStaffNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            data-testid="crm-stalled-toggle"
            type="button"
            role="switch"
            aria-checked={stalledOnly}
            onClick={() => setStalledOnly((v) => !v)}
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1.5 text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
          >
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                stalledOnly ? "bg-[var(--color-primary)]" : "bg-[var(--color-surface-offset)]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  stalledOnly ? "left-4" : "left-0.5"
                }`}
              />
            </span>
            {titleCase("Stalled leads")}
          </button>
          <button data-testid="crm-add-lead-btn" type="button" onClick={() => setIsAddLeadOpen(true)} className="btn-primary h-[34px] gap-2 px-3 text-[13px]">
            <UserPlus className="h-4 w-4" strokeWidth={2} />
            {titleCase("Add Lead")}
          </button>
          <button
            data-testid="crm-refresh-btn"
            type="button"
            disabled={loading}
            onClick={() => void loadLeads()}
            className="btn-ghost h-8 w-8 justify-center p-0 disabled:opacity-50"
            title={titleCase("Refresh")}
          >
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-danger)]/30 bg-[var(--color-danger-light)] px-4 py-3 text-sm text-[var(--color-danger)]" role="alert">
          {error}
        </div>
      ) : null}

      <div className="surface-card inline-flex flex-wrap items-center gap-4 rounded-[var(--radius-md)] px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            {titleCase("Avg. Time in Engagement")}
          </p>
          <p className="font-display mt-1 text-lg font-bold text-[var(--color-primary)]">
            {leadVelocity} {titleCase("Days")}
          </p>
        </div>
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {loading ? titleCase("Loading leads…") : titleCase("Velocity across engagement-stage leads.")}
        </p>
      </div>

      {/* Kanban Board */}
      <div className="min-w-0 overflow-x-auto pb-4">
        <div className="grid w-max min-w-full grid-cols-1 gap-4 pb-1 md:[grid-template-columns:repeat(2,minmax(260px,1fr))] xl:[grid-template-columns:repeat(4,minmax(260px,1fr))]">
          {CURRENT_STAGES.map((stage) => {
            const stageLeads = filteredLeads.filter((l) => l.stage === stage);
            const borderAccent = stageColumnBorder(stage, activeFunnel);
            return (
              <div key={stage} data-testid={`crm-stage-column-${stage.toLowerCase().replace(/\s+/g, "-")}`} className="flex min-h-[400px] min-w-[260px] flex-1 flex-col">
                <div
                  className={`surface-card rounded-b-none border-b-0 px-4 py-3 ${borderAccent} border-l-4`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13px] font-bold uppercase tracking-widest text-[var(--color-text-muted)]">
                      {titleCase(stage)}
                    </h3>
                    <span className="rounded-full bg-[var(--color-surface-offset)] px-2 py-0.5 text-[12px] font-semibold text-[var(--color-text)]">
                      {stageLeads.length}
                    </span>
                  </div>
                </div>
                <div className="surface-card flex flex-col gap-2.5 rounded-t-none border-t-0 bg-[var(--color-surface-offset)] p-3 shadow-none">
                  {stageLeads.map((lead) => {
                    const idx = CURRENT_STAGES.indexOf(lead.stage);
                    const canAdvance = idx >= 0 && idx < CURRENT_STAGES.length - 1;
                    return (
                      <div
                        key={lead.id}
                        data-testid={`crm-lead-card-${lead.id}`}
                        role="button"
                        tabIndex={0}
                        className="surface-card cursor-pointer p-4 transition-all duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-md)]"
                        onClick={() => {
                          setActiveLead(lead);
                          setEmailConnection(null);
                          void loadInteractions(lead);
                          void loadEmailConnection(lead);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            setActiveLead(lead);
                            setEmailConnection(null);
                            void loadInteractions(lead);
                            void loadEmailConnection(lead);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="truncate text-[14px] font-bold text-[var(--color-text)]">{lead.company_name}</h4>
                              {lead.score === "Hot" ? (
                                <span className="shrink-0 rounded-full bg-[var(--color-warning-light)] px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--color-warning)]">
                                  HOT
                                </span>
                              ) : null}
                            </div>
                            {lead.contact_name ? (
                              <p className="mt-1 truncate text-[13px] text-[var(--color-text-muted)]">{lead.contact_name}</p>
                            ) : null}
                          </div>
                          {stalledOnly || new Date(lead.last_interaction_at) < new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) ? (
                            <span title={titleCase("Stalled lead")} className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-red-500" />
                          ) : null}
                        </div>

                        {lead.lead_type === "Regular Recruiter" && (
                          <div
                            className="mt-3 flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                              {titleCase("JDs rcvd:")}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                data-testid={`crm-jd-decrement-${lead.id}`}
                                type="button"
                                onClick={() => handleUpdateJDCount(lead.id, lead.jd_count - 1)}
                                className="flex h-6 w-6 items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                              >
                                −
                              </button>
                              <span data-testid={`crm-jd-count-${lead.id}`} className="w-4 text-center text-xs font-bold">{lead.jd_count}</span>
                              <button
                                data-testid={`crm-jd-increment-${lead.id}`}
                                type="button"
                                onClick={() => handleUpdateJDCount(lead.id, lead.jd_count + 1)}
                                className="flex h-6 w-6 items-center justify-center rounded border border-[var(--color-primary-light)] bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary-light)] text-[10px] font-bold text-[var(--color-primary)]">
                              {lead.staff_name.slice(0, 1).toUpperCase()}
                            </span>
                            <span className="text-[12px] text-[var(--color-text-faint)]">
                              {daysInStage(lead)}d {titleCase("in stage")}
                            </span>
                          </div>
                          {canAdvance ? (
                            <button
                              data-testid={`crm-advance-stage-${lead.id}`}
                              type="button"
                              className="btn-ghost h-8 w-8 shrink-0 justify-center p-0"
                              title={titleCase("Advance stage")}
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = CURRENT_STAGES[idx + 1];
                                if (next) void handleUpdateLeadStage(lead.id, next);
                              }}
                            >
                              <ChevronRight className="h-4 w-4" strokeWidth={2} />
                            </button>
                          ) : (
                            <select
                              className="max-w-[100px] cursor-pointer bg-transparent text-right text-[11px] text-[var(--color-text-muted)]"
                              value={lead.stage}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleUpdateLeadStage(lead.id, e.target.value as LeadStage)}
                            >
                              {CURRENT_STAGES.map((s) => (
                                <option key={s} value={s}>
                                  {titleCase(s)}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {stageLeads.length === 0 && (
                    <div className="flex flex-col items-center justify-center rounded-[var(--radius-md)] border-2 border-dashed border-[var(--color-border)] py-8 text-center">
                      <Users2 className="mb-2 h-6 w-6 text-[var(--color-text-faint)]" strokeWidth={1.5} />
                      <p className="text-[13px] text-[var(--color-text-faint)]">{titleCase("No leads")}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </div>

      {/* Add Lead Modal — rendered outside the space-y-5 container above so Tailwind's
          sibling margin utility doesn't push this fixed-position overlay down from the
          true viewport top (it did — see the CRM companies panel top-gap bug). */}
      {isAddLeadOpen && (
        <div
          className="animate-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[var(--nucleus-deep)]/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-lead-title"
          onClick={() => setIsAddLeadOpen(false)}
        >
          <div
            data-testid="crm-add-lead-modal"
            className="card animate-scale-in w-full max-w-lg bg-[var(--color-surface)] p-6 shadow-[var(--shadow-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="add-lead-title" className="font-display mb-4 text-lg font-bold text-[var(--color-text)]">
              {titleCase("Add corporate lead")}
            </h2>
            <form data-testid="crm-add-lead-form" onSubmit={handleAddLead} className="space-y-4">
              <div>
                <label htmlFor="lead-company" className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">
                  {titleCase("Company name *")}
                </label>
                <input
                  id="lead-company"
                  data-testid="crm-lead-company-input"
                  required
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  className="input-field"
                  placeholder={titleCase("e.g. Acme Corp")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="lead-type" className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">
                    {titleCase("Lead type")}
                  </label>
                  <select
                    id="lead-type"
                    data-testid="crm-lead-type-select"
                    value={newLeadType}
                    onChange={(e) => setNewLeadType(e.target.value as LeadType)}
                    className="input-field"
                  >
                    <option value="New Lead">{titleCase("New lead (pipeline)")}</option>
                    <option value="Regular Recruiter">{titleCase("Regular recruiter")}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="lead-staff" className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">
                    {titleCase("Staff member")}
                  </label>
                  <input
                    id="lead-staff"
                    value={newStaff}
                    onChange={(e) => setNewStaff(e.target.value)}
                    className="input-field"
                    placeholder={titleCase("e.g. John Smith")}
                  />
                </div>
                <div>
                  <label htmlFor="lead-contact" className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">
                    {titleCase("Contact person")}
                  </label>
                  <input
                    id="lead-contact"
                    value={newContact}
                    onChange={(e) => setNewContact(e.target.value)}
                    className="input-field"
                    placeholder={titleCase("e.g. Jane Doe")}
                  />
                </div>
                <div>
                  <label htmlFor="lead-email" className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">{titleCase("Email")}</label>
                  <input
                    id="lead-email"
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="input-field"
                    placeholder="jane@acme.com"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="lead-phone" className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">{titleCase("Phone")}</label>
                  <input
                    id="lead-phone"
                    type="tel"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="input-field"
                    placeholder="+1 234 567 8900"
                  />
                </div>
                <div>
                  <label htmlFor="lead-score" className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">
                    {titleCase("Initial lead score")}
                  </label>
                  <select
                    id="lead-score"
                    data-testid="crm-lead-score-select"
                    value={newScore}
                    onChange={(e) => setNewScore(e.target.value as LeadScore)}
                    className="input-field"
                  >
                    <option value="Hot">{titleCase("Hot (high intent)")}</option>
                    <option value="Warm">{titleCase("Warm (interested)")}</option>
                    <option value="Cold">{titleCase("Cold (outreach)")}</option>
                  </select>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-3 border-t border-[var(--color-border)] pt-4">
                <button data-testid="crm-add-lead-cancel" type="button" onClick={() => setIsAddLeadOpen(false)} className="btn-ghost">
                  {titleCase("Cancel")}
                </button>
                <button data-testid="crm-add-lead-submit" type="submit" className="btn-primary">
                  {titleCase("Save lead")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Interactions Slide-over */}
      {activeLead && (
        <div
          className="animate-backdrop-in fixed inset-0 z-50 flex justify-end bg-[var(--nucleus-deep)]/45 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lead-panel-title"
          onClick={() => setActiveLead(null)}
        >
          <div
            className="flex h-full w-full max-w-md flex-col bg-[var(--color-surface)] shadow-[var(--shadow-lg)] animate-slide-in-right"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)] p-5">
              <div className="min-w-0">
                <h2 id="lead-panel-title" className="font-display truncate text-lg font-bold text-[var(--color-text)]">{activeLead.company_name}</h2>
                <p className="truncate text-sm text-[var(--color-text-muted)]">
                  {activeLead.contact_name || titleCase("No contact person")}
                </p>
                {activeLead.email && <p className="mt-0.5 truncate text-xs font-medium text-[var(--color-primary)]">{activeLead.email}</p>}
              </div>
              <button data-testid="crm-lead-panel-close" onClick={() => setActiveLead(null)} aria-label={titleCase("Close")} className="btn-ghost shrink-0 rounded-full p-2"><IconX className="h-5 w-5" /></button>
            </div>

            {activeLead.email && (
              <div
                data-testid="crm-email-connection"
                className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      loadingEmailConnection
                        ? "animate-pulse bg-[var(--color-text-faint)]"
                        : CONNECTION_STRENGTH_DOT[emailConnection?.connectionStrength ?? "No communication"]
                    }`}
                  />
                  <span className="text-xs font-medium text-[var(--color-text)]">
                    {loadingEmailConnection
                      ? titleCase("Checking email history...")
                      : emailConnection
                        ? titleCase(emailConnection.connectionStrength)
                        : titleCase("Not synced yet")}
                  </span>
                  {emailConnection?.lastInteractionAt && (
                    <span className="text-xs text-[var(--color-text-muted)]">
                      · {new Date(emailConnection.lastInteractionAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  data-testid="crm-email-connection-refresh"
                  onClick={() => void loadEmailConnection(activeLead, true)}
                  disabled={loadingEmailConnection}
                  aria-label={titleCase("Refresh email connection")}
                  className="btn-ghost shrink-0 rounded-full p-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingEmailConnection ? "animate-spin" : ""}`} />
                </button>
              </div>
            )}

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {/* Interaction Form */}
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                <h3 className="mb-3 text-sm font-semibold text-[var(--color-text)]">{titleCase("Log interaction")}</h3>
                <form data-testid="crm-interaction-form" onSubmit={handleAddInteraction} className="space-y-3">
                  <select
                    data-testid="crm-interaction-type-select"
                    aria-label={titleCase("Interaction type")}
                    value={interactionType}
                    onChange={(e) =>
                      setInteractionType(e.target.value as InteractionRow["interaction_type"])
                    }
                    className="input-field py-1.5 text-sm"
                  >
                    <option value="Note">{titleCase("Note / update")}</option>
                    <option value="Call">{titleCase("Phone call")}</option>
                    <option value="Email">{titleCase("Email sent")}</option>
                    <option value="Meeting">{titleCase("Meeting (e.g. Meet/Zoom)")}</option>
                  </select>
                  <textarea
                    data-testid="crm-interaction-notes"
                    required
                    rows={3}
                    value={interactionNotes}
                    onChange={e => setInteractionNotes(e.target.value)}
                    placeholder={titleCase("Enter details...")}
                    className="input-field h-auto resize-none py-2 text-sm"
                  ></textarea>
                  <button data-testid="crm-interaction-submit" type="submit" className="btn-primary w-full justify-center py-2 text-sm">
                    {titleCase("Log activity")}
                  </button>
                </form>
              </div>

              {/* History / Meetings Toggle */}
              <div>
                <div className="relative mb-4 flex flex-wrap gap-x-1 border-b border-[var(--color-border)]">
                  <button
                    data-testid="crm-tab-history"
                    type="button"
                    onClick={() => setActivePanelTab("History")}
                    className={`relative px-3 pb-2 text-sm font-medium transition-colors sm:px-4 ${
                      activePanelTab === "History"
                        ? "z-[1] -mb-px border-b-2 border-[var(--color-primary)] text-[var(--color-text)]"
                        : "border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {titleCase(`History (${interactions.length})`)}
                  </button>
                  <button
                    data-testid="crm-tab-meetings"
                    type="button"
                    onClick={() => setActivePanelTab("Meetings")}
                    className={`relative flex items-center gap-1.5 px-3 pb-2 text-sm font-medium transition-colors sm:px-4 ${
                      activePanelTab === "Meetings"
                        ? "z-[1] -mb-px border-b-2 border-[var(--color-primary)] text-[var(--color-text)]"
                        : "border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    <IconCalendar className="h-3.5 w-3.5 shrink-0" />
                    {titleCase(`GMeet summaries (${meetings.length})`)}
                  </button>
                </div>

                {loadingInteractions ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{titleCase("Loading...")}</p>
                ) : activePanelTab === "History" ? (
                  interactions.length === 0 ? (
                    <p className="text-sm italic text-[var(--color-text-muted)]">{titleCase("No interactions recorded.")}</p>
                  ) : (
                    <div className="relative space-y-4 before:absolute before:inset-0 before:ml-5 before:h-full before:w-0.5 before:-translate-x-px before:bg-gradient-to-b before:from-transparent before:via-[var(--color-border-strong)] before:to-transparent md:before:mx-auto md:before:translate-x-0">
                      {interactions.map((i) => (
                        <div key={i.id} className="group is-active relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-surface)] bg-[var(--color-surface-offset)] text-[var(--color-text-muted)] shadow-[var(--shadow-sm)] md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2">
                            {i.interaction_type === "Call" && <IconPhone className="h-4 w-4" />}
                            {i.interaction_type === "Email" && <IconMail className="h-4 w-4" />}
                            {i.interaction_type === "Meeting" && <IconUser className="h-4 w-4" />}
                            {i.interaction_type === "Note" && <IconMenu className="h-4 w-4" />}
                          </div>
                          <div className="w-[calc(100%-4rem)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-sm)] md:w-[calc(50%-2.5rem)]">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-sm font-bold text-[var(--color-text)]">
                                {titleCase(i.interaction_type)}
                              </span>
                              <time className="text-xs font-medium text-[var(--color-primary)]">{new Date(i.created_at).toLocaleDateString()}</time>
                            </div>
                            <div className="whitespace-pre-wrap text-xs text-[var(--color-text-muted)]">{i.notes}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  meetings.length === 0 ? (
                    <div className="rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-6 text-center">
                      <p className="text-sm text-[var(--color-text-muted)]">
                        {titleCase("No Google Meet summaries found for")}{" "}
                        <span className="font-medium text-[var(--color-text)]">
                          {activeLead.email || titleCase("this lead")}
                        </span>
                        .
                      </p>
                      <p className="mt-2 text-xs text-[var(--color-text-faint)]">
                        {titleCase(
                          "Make sure your meeting notetaker joins the meeting and you have added their exact email address above."
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {meetings.map((m) => (
                        <div key={m.id} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-sm)]">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-sm font-bold text-[var(--color-text)]">
                              <IconCalendar className="h-4 w-4 text-[var(--color-primary)]" /> {titleCase("Meeting notes")}
                            </span>
                            <time className="text-xs font-medium text-[var(--color-text-muted)]">{new Date(m.created_at).toLocaleDateString()}</time>
                          </div>
                          <div className="mt-2 whitespace-pre-wrap rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-xs leading-relaxed text-[var(--color-text-muted)]">
                            {m.summary ? (
                              m.summary
                            ) : (
                              <span className="italic text-[var(--color-text-faint)]">{titleCase("Processing summary...")}</span>
                            )}
                          </div>
                          <a href={m.meeting_url} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] hover:text-[var(--color-primary-hover)]">
                            {titleCase("View transcript →")}
                          </a>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

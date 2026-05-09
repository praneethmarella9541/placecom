"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { UserPlus, ChevronRight, Users2, RefreshCw } from "lucide-react";
import { IconPhone, IconMail, IconMenu, IconX, IconCalendar, IconUser } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";

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
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <h1 className="font-display text-[17px] font-bold text-[var(--color-text)]">
            {titleCase("Marketing Funnel CRM")}
          </h1>
          <div className="flex items-center gap-0.5 rounded-[var(--radius-md)] bg-[var(--color-surface-offset)] p-0.5">
            <button
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
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
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
          <button type="button" onClick={() => setIsAddLeadOpen(true)} className="btn-primary h-[34px] gap-2 px-3 text-[13px]">
            <UserPlus className="h-4 w-4" strokeWidth={2} />
            {titleCase("Add Lead")}
          </button>
          <button
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
        <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
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
              <div key={stage} className="flex min-h-[400px] min-w-[260px] flex-1 flex-col">
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
                        role="button"
                        tabIndex={0}
                        className="surface-card cursor-pointer p-4 transition-all duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-md)]"
                        onClick={() => {
                          setActiveLead(lead);
                          void loadInteractions(lead);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            setActiveLead(lead);
                            void loadInteractions(lead);
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="truncate text-[14px] font-bold text-[var(--color-text)]">{lead.company_name}</h4>
                              {lead.score === "Hot" ? (
                                <span className="shrink-0 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-bold uppercase text-[#92400e]">
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
                                type="button"
                                onClick={() => handleUpdateJDCount(lead.id, lead.jd_count - 1)}
                                className="flex h-6 w-6 items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"
                              >
                                −
                              </button>
                              <span className="w-4 text-center text-xs font-bold">{lead.jd_count}</span>
                              <button
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

      {/* Add Lead Modal */}
      {isAddLeadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="card w-full max-w-lg bg-white dark:bg-zinc-950 p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
              {titleCase("Add corporate lead")}
            </h2>
            <form onSubmit={handleAddLead} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">
                  {titleCase("Company name *")}
                </label>
                <input
                  required
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  className="input-field"
                  placeholder={titleCase("e.g. Acme Corp")}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    {titleCase("Lead type")}
                  </label>
                  <select
                    value={newLeadType}
                    onChange={(e) => setNewLeadType(e.target.value as LeadType)}
                    className="input-field"
                  >
                    <option value="New Lead">{titleCase("New lead (pipeline)")}</option>
                    <option value="Regular Recruiter">{titleCase("Regular recruiter")}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    {titleCase("Staff member")}
                  </label>
                  <input
                    value={newStaff}
                    onChange={(e) => setNewStaff(e.target.value)}
                    className="input-field"
                    placeholder={titleCase("e.g. John Smith")}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    {titleCase("Contact person")}
                  </label>
                  <input
                    value={newContact}
                    onChange={(e) => setNewContact(e.target.value)}
                    className="input-field"
                    placeholder={titleCase("e.g. Jane Doe")}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">{titleCase("Email")}</label>
                  <input
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
                  <label className="block text-xs font-medium text-zinc-500 mb-1">{titleCase("Phone")}</label>
                  <input
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    className="input-field"
                    placeholder="+1 234 567 8900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">
                    {titleCase("Initial lead score")}
                  </label>
                  <select
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
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <button type="button" onClick={() => setIsAddLeadOpen(false)} className="btn-ghost">
                  {titleCase("Cancel")}
                </button>
                <button type="submit" className="btn-primary">
                  {titleCase("Save lead")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Interactions Slide-over */}
      {activeLead && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-md bg-white dark:bg-zinc-950 h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50">
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">{activeLead.company_name}</h2>
                <p className="text-sm text-zinc-500">
                  {activeLead.contact_name || titleCase("No contact person")}
                </p>
                {activeLead.email && <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">{activeLead.email}</p>}
              </div>
              <button onClick={() => setActiveLead(null)} className="btn-ghost p-2 rounded-full"><IconX className="h-5 w-5" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Interaction Form */}
              <div className="bg-zinc-50 dark:bg-zinc-900/30 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
                <h3 className="text-sm font-semibold mb-3">{titleCase("Log interaction")}</h3>
                <form onSubmit={handleAddInteraction} className="space-y-3">
                  <select 
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
                    required
                    rows={3} 
                    value={interactionNotes}
                    onChange={e => setInteractionNotes(e.target.value)}
                    placeholder={titleCase("Enter details...")} 
                    className="input-field text-sm resize-none"
                  ></textarea>
                  <button type="submit" className="btn-primary w-full py-2 text-sm justify-center">
                    {titleCase("Log activity")}
                  </button>
                </form>
              </div>

              {/* History / Meetings Toggle */}
              <div>
                <div className="relative mb-4 flex flex-wrap gap-x-1 border-b border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setActivePanelTab("History")}
                    className={`relative px-3 pb-2 text-sm font-medium transition-colors sm:px-4 ${
                      activePanelTab === "History"
                        ? "z-[1] -mb-px border-b-2 border-emerald-500 text-zinc-900 dark:text-white"
                        : "border-b-2 border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    {titleCase(`History (${interactions.length})`)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanelTab("Meetings")}
                    className={`relative flex items-center gap-1.5 px-3 pb-2 text-sm font-medium transition-colors sm:px-4 ${
                      activePanelTab === "Meetings"
                        ? "z-[1] -mb-px border-b-2 border-emerald-500 text-zinc-900 dark:text-white"
                        : "border-b-2 border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                  >
                    <IconCalendar className="h-3.5 w-3.5 shrink-0" />
                    {titleCase(`GMeet summaries (${meetings.length})`)}
                  </button>
                </div>

                {loadingInteractions ? (
                  <p className="text-sm text-zinc-500">{titleCase("Loading...")}</p>
                ) : activePanelTab === "History" ? (
                  interactions.length === 0 ? (
                    <p className="text-sm text-zinc-500 italic">{titleCase("No interactions recorded.")}</p>
                  ) : (
                    <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
                      {interactions.map((i) => (
                        <div key={i.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                          <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-100 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-950">
                            {i.interaction_type === "Call" && <IconPhone className="h-4 w-4" />}
                            {i.interaction_type === "Email" && <IconMail className="h-4 w-4" />}
                            {i.interaction_type === "Meeting" && <IconUser className="h-4 w-4" />}
                            {i.interaction_type === "Note" && <IconMenu className="h-4 w-4" />}
                          </div>
                          <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded border border-slate-200 bg-white shadow-sm dark:bg-zinc-900 dark:border-zinc-800">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold text-slate-900 dark:text-white text-sm">
                                {titleCase(i.interaction_type)}
                              </span>
                              <time className="font-caveat font-medium text-emerald-600 dark:text-emerald-400 text-xs">{new Date(i.created_at).toLocaleDateString()}</time>
                            </div>
                            <div className="text-slate-500 dark:text-slate-400 text-xs whitespace-pre-wrap">{i.notes}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  meetings.length === 0 ? (
                    <div className="text-center p-6 bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700">
                      <p className="text-sm text-zinc-500">
                        {titleCase("No Google Meet summaries found for")}{" "}
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {activeLead.email || titleCase("this lead")}
                        </span>
                        .
                      </p>
                      <p className="text-xs text-zinc-400 mt-2">
                        {titleCase(
                          "Make sure your meeting notetaker joins the meeting and you have added their exact email address above."
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {meetings.map((m) => (
                        <div key={m.id} className="p-4 rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-800 shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-1.5">
                              <IconCalendar className="h-4 w-4 text-emerald-600" /> {titleCase("Meeting notes")}
                            </span>
                            <time className="text-xs font-medium text-zinc-500">{new Date(m.created_at).toLocaleDateString()}</time>
                          </div>
                          <div className="mt-2 p-3 bg-zinc-50 dark:bg-zinc-950 rounded-lg text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed border border-zinc-100 dark:border-zinc-800">
                            {m.summary ? (
                              m.summary
                            ) : (
                              <span className="italic text-zinc-400">{titleCase("Processing summary...")}</span>
                            )}
                          </div>
                          <a href={m.meeting_url} target="_blank" rel="noreferrer" className="mt-3 text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1">
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
    </div>
  );
}

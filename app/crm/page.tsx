"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { IconRefresh, IconPlus, IconUser, IconPhone, IconMail, IconMenu, IconX, IconCalendar } from "@/components/Icons";

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

function getScoreColor(score: LeadScore) {
  if (score === "Hot") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800/50";
  if (score === "Warm") return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200 dark:border-orange-800/50";
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800/50";
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
    } catch (e: any) {
      setError(e.message);
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

  const funnelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    CURRENT_STAGES.forEach(s => counts[s] = 0);
    filteredLeads.forEach(l => {
      if (counts[l.stage] !== undefined) counts[l.stage]++;
    });
    return counts;
  }, [filteredLeads, CURRENT_STAGES]);

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
    } catch (err: any) {
      alert(err.message);
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
    } catch (err: any) {
      alert(err.message);
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
    } catch (err: any) {
      alert(err.message);
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
    } catch (err: any) {
      alert(err.message);
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
    } catch (err: any) {
      alert(err.message);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Marketing Funnel CRM
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Manage corporate leads through the placement pipeline.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void loadLeads()} className="btn-ghost">
            <IconRefresh className="h-4 w-4" /> Refresh
          </button>
          <button type="button" onClick={() => setIsAddLeadOpen(true)} className="btn-primary">
            <IconPlus className="h-4 w-4" /> Add Lead
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}

      {/* Funnel Switcher */}
      <div className="flex border-b border-zinc-200 dark:border-zinc-800">
        <button 
          onClick={() => setActiveFunnel("New Lead")}
          className={`py-3 px-6 font-semibold text-sm border-b-2 transition-colors ${activeFunnel === "New Lead" ? "border-emerald-500 text-emerald-600 dark:text-emerald-400" : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
        >
          New Leads Pipeline
        </button>
        <button 
          onClick={() => setActiveFunnel("Regular Recruiter")}
          className={`py-3 px-6 font-semibold text-sm border-b-2 transition-colors ${activeFunnel === "Regular Recruiter" ? "border-emerald-500 text-emerald-600 dark:text-emerald-400" : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
        >
          Regular Recruiters
        </button>
      </div>

      {/* Top Metrics Dashboard */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {CURRENT_STAGES.map((stage, idx) => (
          <div key={stage} className={`card p-4 flex flex-col justify-between ${idx > 0 ? ['border-l-4 border-l-orange-400', 'border-l-4 border-l-emerald-500', 'border-l-4 border-l-indigo-500'][idx-1] : ''}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{stage}</p>
            <p className="mt-2 text-3xl font-bold text-zinc-900 dark:text-white">{funnelCounts[stage]}</p>
            <p className="mt-1 text-xs text-zinc-400">Total</p>
          </div>
        ))}
        <div className="card p-4 flex flex-col justify-between bg-zinc-900 dark:bg-zinc-800 text-white shadow-xl">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Velocity</p>
          <p className="mt-2 text-3xl font-bold">{leadVelocity} <span className="text-lg font-normal text-zinc-400">days</span></p>
          <p className="mt-1 text-xs text-zinc-400">Avg. time in Engagement</p>
        </div>
      </div>

      {/* Placement Head Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between bg-white dark:bg-zinc-950 p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Staff View:</label>
          <select 
            className="input-field py-1.5 min-w-[150px]"
            value={staffFilter}
            onChange={e => setStaffFilter(e.target.value)}
          >
            <option value="All">All Staff</option>
            {allStaffNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="checkbox" 
            id="stalledFilter"
            checked={stalledOnly}
            onChange={e => setStalledOnly(e.target.checked)}
            className="rounded border-zinc-300 text-red-600 focus:ring-red-500"
          />
          <label htmlFor="stalledFilter" className="text-sm font-medium text-red-600 dark:text-red-400 flex items-center gap-1 cursor-pointer">
            <span className="flex h-2 w-2 rounded-full bg-red-500"></span>
            Show Stalled Leads ({'>'}3 days no activity)
          </label>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 overflow-x-auto pb-4">
        {CURRENT_STAGES.map(stage => {
          const stageLeads = filteredLeads.filter(l => l.stage === stage);
          return (
            <div key={stage} className="flex flex-col bg-zinc-50/80 dark:bg-zinc-900/40 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3 min-w-[280px] h-full min-h-[500px]">
              <div className="flex items-center justify-between mb-4 px-2">
                <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">{stage}</h3>
                <span className="bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-xs px-2 py-1 rounded-full font-medium">
                  {stageLeads.length}
                </span>
              </div>
              <div className="flex flex-col gap-3 flex-1">
                {stageLeads.map(lead => (
                  <div 
                    key={lead.id} 
                    className="card p-3 cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-500 transition-colors shadow-sm bg-white dark:bg-zinc-950"
                    onClick={() => {
                      setActiveLead(lead);
                      void loadInteractions(lead);
                    }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getScoreColor(lead.score)}`}>
                        {lead.score}
                      </span>
                      {stalledOnly || new Date(lead.last_interaction_at) < new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) ? (
                         <span title="Stalled Lead" className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] animate-pulse"></span>
                      ) : null}
                    </div>
                    <h4 className="font-semibold text-zinc-900 dark:text-zinc-100 line-clamp-1">{lead.company_name}</h4>
                    {lead.contact_name && <p className="text-xs text-zinc-500 mt-1 line-clamp-1 flex items-center gap-1"><IconUser className="h-3 w-3" /> {lead.contact_name}</p>}
                    
                    {/* Regular Recruiter JD Counter */}
                    {lead.lead_type === "Regular Recruiter" && (
                      <div className="mt-3 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900 rounded p-1.5 border border-zinc-200 dark:border-zinc-800" onClick={e => e.stopPropagation()}>
                        <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider">JDs Rcvd:</span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleUpdateJDCount(lead.id, lead.jd_count - 1)} className="w-5 h-5 flex items-center justify-center rounded bg-white border shadow-sm text-zinc-500 hover:text-zinc-900">-</button>
                          <span className="text-xs font-bold w-4 text-center">{lead.jd_count}</span>
                          <button onClick={() => handleUpdateJDCount(lead.id, lead.jd_count + 1)} className="w-5 h-5 flex items-center justify-center rounded bg-emerald-100 text-emerald-700 border border-emerald-200 shadow-sm hover:bg-emerald-200">+</button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                      <p className="text-[10px] text-zinc-400 font-medium">Staff: {lead.staff_name}</p>
                      {/* Stage Mover */}
                      <select 
                        className="text-[10px] bg-transparent text-zinc-500 border-none p-0 cursor-pointer focus:ring-0 w-[80px] text-right"
                        value={lead.stage}
                        onClick={e => e.stopPropagation()}
                        onChange={(e) => handleUpdateLeadStage(lead.id, e.target.value as LeadStage)}
                      >
                        {CURRENT_STAGES.map(s => <option key={s} value={s}>Move to {s}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
                {stageLeads.length === 0 && (
                  <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl flex items-center justify-center p-6 text-zinc-400 text-sm">
                    No leads
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Lead Modal */}
      {isAddLeadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="card w-full max-w-lg bg-white dark:bg-zinc-950 p-6 shadow-2xl">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Add Corporate Lead</h2>
            <form onSubmit={handleAddLead} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-500 mb-1">Company Name *</label>
                <input required value={newCompany} onChange={e => setNewCompany(e.target.value)} className="input-field" placeholder="e.g. Acme Corp" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Lead Type</label>
                  <select value={newLeadType} onChange={e => setNewLeadType(e.target.value as LeadType)} className="input-field">
                    <option value="New Lead">New Lead (Pipeline)</option>
                    <option value="Regular Recruiter">Regular Recruiter</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Staff Member</label>
                  <input value={newStaff} onChange={e => setNewStaff(e.target.value)} className="input-field" placeholder="e.g. John Smith" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Contact Person</label>
                  <input value={newContact} onChange={e => setNewContact(e.target.value)} className="input-field" placeholder="e.g. Jane Doe" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Email</label>
                  <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="input-field" placeholder="jane@acme.com" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Phone</label>
                  <input value={newPhone} onChange={e => setNewPhone(e.target.value)} className="input-field" placeholder="+1 234 567 8900" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-500 mb-1">Initial Lead Score</label>
                  <select value={newScore} onChange={e => setNewScore(e.target.value as LeadScore)} className="input-field">
                    <option value="Hot">Hot (High Intent)</option>
                    <option value="Warm">Warm (Interested)</option>
                    <option value="Cold">Cold (Outreach)</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <button type="button" onClick={() => setIsAddLeadOpen(false)} className="btn-ghost">Cancel</button>
                <button type="submit" className="btn-primary">Save Lead</button>
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
                <p className="text-sm text-zinc-500">{activeLead.contact_name || "No Contact Person"}</p>
                {activeLead.email && <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">{activeLead.email}</p>}
              </div>
              <button onClick={() => setActiveLead(null)} className="btn-ghost p-2 rounded-full"><IconX className="h-5 w-5" /></button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Interaction Form */}
              <div className="bg-zinc-50 dark:bg-zinc-900/30 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
                <h3 className="text-sm font-semibold mb-3">Log Interaction</h3>
                <form onSubmit={handleAddInteraction} className="space-y-3">
                  <select 
                    value={interactionType} 
                    onChange={e => setInteractionType(e.target.value as any)} 
                    className="input-field py-1.5 text-sm"
                  >
                    <option value="Note">Note / Update</option>
                    <option value="Call">Phone Call</option>
                    <option value="Email">Email Sent</option>
                    <option value="Meeting">Meeting (e.g. Meet/Zoom)</option>
                  </select>
                  <textarea 
                    required
                    rows={3} 
                    value={interactionNotes}
                    onChange={e => setInteractionNotes(e.target.value)}
                    placeholder="Enter details..." 
                    className="input-field text-sm resize-none"
                  ></textarea>
                  <button type="submit" className="btn-primary w-full py-2 text-sm justify-center">Log Activity</button>
                </form>
              </div>

              {/* History / Meetings Toggle */}
              <div>
                <div className="flex border-b border-zinc-200 dark:border-zinc-800 mb-4">
                  <button 
                    onClick={() => setActivePanelTab("History")}
                    className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors ${activePanelTab === "History" ? "border-emerald-500 text-zinc-900 dark:text-white" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
                  >
                    History ({interactions.length})
                  </button>
                  <button 
                    onClick={() => setActivePanelTab("Meetings")}
                    className={`pb-2 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${activePanelTab === "Meetings" ? "border-emerald-500 text-zinc-900 dark:text-white" : "border-transparent text-zinc-500 hover:text-zinc-700"}`}
                  >
                    <IconCalendar className="h-3.5 w-3.5" /> GMeet Summaries ({meetings.length})
                  </button>
                </div>

                {loadingInteractions ? (
                  <p className="text-sm text-zinc-500">Loading...</p>
                ) : activePanelTab === "History" ? (
                  interactions.length === 0 ? (
                    <p className="text-sm text-zinc-500 italic">No interactions recorded.</p>
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
                              <span className="font-bold text-slate-900 dark:text-white text-sm">{i.interaction_type}</span>
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
                      <p className="text-sm text-zinc-500">No Google Meet summaries found for <span className="font-medium text-zinc-700 dark:text-zinc-300">{activeLead.email || "this lead"}</span>.</p>
                      <p className="text-xs text-zinc-400 mt-2">Make sure Fireflies joins the meeting and you have added their exact email address above.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {meetings.map((m) => (
                        <div key={m.id} className="p-4 rounded-xl border border-zinc-200 bg-white dark:bg-zinc-900 dark:border-zinc-800 shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-bold text-sm text-zinc-900 dark:text-white flex items-center gap-1.5"><IconCalendar className="h-4 w-4 text-emerald-600" /> Fireflies AI</span>
                            <time className="text-xs font-medium text-zinc-500">{new Date(m.created_at).toLocaleDateString()}</time>
                          </div>
                          <div className="mt-2 p-3 bg-zinc-50 dark:bg-zinc-950 rounded-lg text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed border border-zinc-100 dark:border-zinc-800">
                            {m.summary ? m.summary : <span className="italic text-zinc-400">Processing summary...</span>}
                          </div>
                          <a href={m.meeting_url} target="_blank" rel="noreferrer" className="mt-3 text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1">
                            View Transcript &rarr;
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

"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { IconX, IconMail, IconCalendar, IconMenu } from "@/components/Icons";
import { titleCase } from "@/lib/title-case";
import { CONNECTION_STRENGTH_DOT } from "@/lib/connection-strength-ui";
import type { EmailConnectionStrength } from "@/lib/email-connection-strength";
import { ThreadPreviewModal } from "@/components/ThreadPreviewModal";

type CompanyDetail = {
  id: string;
  domain: string;
  company_name: string;
  last_interaction_at: string | null;
  connection_strength: EmailConnectionStrength | null;
  message_count_total: number;
  message_count_90d: number;
};

type ContactRow = {
  id: string;
  email: string;
  display_name: string | null;
  last_interaction_at: string | null;
  message_count: number;
};

type ActivityItem = {
  id: string;
  threadId?: string;
  from: string;
  subject: string;
  date: string;
  snippet?: string;
};

type NoteRow = { id: string; body: string; created_at: string };

type NextEvent = {
  summary: string;
  start: { dateTime?: string; date?: string };
} | null;

type PanelTab = "Overview" | "Activity" | "Emails" | "Notes";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function CompanyDetailPanel({
  companyId,
  onClose,
}: {
  companyId: string;
  onClose: () => void;
}) {
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [nextEvent, setNextEvent] = useState<NextEvent>(null);
  const [activeTab, setActiveTab] = useState<PanelTab>("Overview");

  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [emails, setEmails] = useState<ActivityItem[] | null>(null);
  const [notes, setNotes] = useState<NoteRow[] | null>(null);
  const [noteText, setNoteText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [tabLoading, setTabLoading] = useState(false);
  const [emailSearchInput, setEmailSearchInput] = useState("");
  const [emailSearchQuery, setEmailSearchQuery] = useState("");
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);

  useEffect(() => {
    setActiveTab("Overview");
    setActivity(null);
    setEmails(null);
    setNotes(null);
    setEmailSearchInput("");
    setEmailSearchQuery("");
    setLoadingOverview(true);

    (async () => {
      try {
        const res = await fetch(`/api/crm/companies/${companyId}`);
        if (res.ok) {
          const json = await res.json();
          setCompany(json.company);
          setContacts(json.contacts || []);
        }
      } finally {
        setLoadingOverview(false);
      }
    })();

    (async () => {
      try {
        const res = await fetch(`/api/crm/companies/${companyId}/next-event`);
        if (res.ok) {
          const json = await res.json();
          setNextEvent(json.event ?? null);
        }
      } catch {
        setNextEvent(null);
      }
    })();
  }, [companyId]);

  useEffect(() => {
    if (activeTab === "Activity" && activity === null) {
      setTabLoading(true);
      fetch(`/api/crm/companies/${companyId}/activity`)
        .then((res) => (res.ok ? res.json() : { activity: [] }))
        .then((json) => setActivity(json.activity || []))
        .catch(() => setActivity([]))
        .finally(() => setTabLoading(false));
    }
    if (activeTab === "Emails" && emails === null) {
      setTabLoading(true);
      const url = emailSearchQuery
        ? `/api/crm/companies/${companyId}/emails?q=${encodeURIComponent(emailSearchQuery)}`
        : `/api/crm/companies/${companyId}/emails`;
      fetch(url)
        .then((res) => (res.ok ? res.json() : { emails: [] }))
        .then((json) => setEmails(json.emails || []))
        .catch(() => setEmails([]))
        .finally(() => setTabLoading(false));
    }
    if (activeTab === "Notes" && notes === null) {
      setTabLoading(true);
      fetch(`/api/crm/companies/${companyId}/notes`)
        .then((res) => (res.ok ? res.json() : { notes: [] }))
        .then((json) => setNotes(json.notes || []))
        .catch(() => setNotes([]))
        .finally(() => setTabLoading(false));
    }
  }, [activeTab, companyId, activity, emails, notes, emailSearchQuery]);

  function handleEmailSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setEmails(null);
    setEmailSearchQuery(emailSearchInput.trim());
  }

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSubmittingNote(true);
    try {
      const res = await fetch(`/api/crm/companies/${companyId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: noteText }),
      });
      if (!res.ok) throw new Error("Failed to add note");
      const json = await res.json();
      setNotes((prev) => [json.note, ...(prev || [])]);
      setNoteText("");
    } catch (err: unknown) {
      alert(errMessage(err));
    } finally {
      setSubmittingNote(false);
    }
  }

  const connectionStrength = company?.connection_strength ?? "No communication";

  return (
    <div
      className="animate-backdrop-in fixed inset-0 z-50 flex justify-end bg-[var(--nucleus-deep)]/45 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="company-panel-title"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-[var(--color-surface)] shadow-[var(--shadow-lg)] animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-2)] p-5">
          <div className="min-w-0">
            <h2
              id="company-panel-title"
              className="font-display truncate text-lg font-bold text-[var(--color-text)]"
            >
              {company?.company_name || titleCase("Loading...")}
            </h2>
            {company?.domain && (
              <p className="truncate text-sm text-[var(--color-text-muted)]">{company.domain}</p>
            )}
          </div>
          <button
            data-testid="crm-company-panel-close"
            onClick={onClose}
            aria-label={titleCase("Close")}
            className="btn-ghost shrink-0 rounded-full p-2"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                loadingOverview ? "animate-pulse bg-[var(--color-text-faint)]" : CONNECTION_STRENGTH_DOT[connectionStrength]
              }`}
            />
            <span className="text-xs font-medium text-[var(--color-text)]">
              {loadingOverview ? titleCase("Loading...") : titleCase(connectionStrength)}
            </span>
            {company?.last_interaction_at && (
              <span className="text-xs text-[var(--color-text-muted)]">
                · {new Date(company.last_interaction_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <div className="relative mb-2 flex flex-wrap gap-x-1 border-b border-[var(--color-border)]">
            {(["Overview", "Activity", "Emails", "Notes"] as PanelTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                data-testid={`crm-company-tab-${tab.toLowerCase()}`}
                onClick={() => setActiveTab(tab)}
                className={`relative px-3 pb-2 text-sm font-medium transition-colors sm:px-4 ${
                  activeTab === tab
                    ? "z-[1] -mb-px border-b-2 border-[var(--color-primary)] text-[var(--color-text)]"
                    : "border-b-2 border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                }`}
              >
                {titleCase(tab)}
              </button>
            ))}
          </div>

          {activeTab === "Overview" && (
            <div className="space-y-5">
              <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text)]">
                  <IconCalendar className="h-3.5 w-3.5" />
                  {titleCase("Next meeting")}
                </h3>
                {nextEvent ? (
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">{nextEvent.summary}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {new Date(nextEvent.start.dateTime || nextEvent.start.date || "").toLocaleString()}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm italic text-[var(--color-text-muted)]">
                    {titleCase("No upcoming meetings.")}
                  </p>
                )}
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">
                  {titleCase(`Contacts (${contacts.length})`)}
                </h3>
                {contacts.length === 0 ? (
                  <p className="text-sm italic text-[var(--color-text-muted)]">
                    {titleCase("No known contacts yet.")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {contacts.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--color-text)]">
                            {c.display_name || c.email}
                          </p>
                          {c.display_name && (
                            <p className="truncate text-xs text-[var(--color-text-muted)]">{c.email}</p>
                          )}
                        </div>
                        {c.last_interaction_at && (
                          <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                            {new Date(c.last_interaction_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "Activity" && (
            <div className="space-y-3">
              {tabLoading && activity === null ? (
                <p className="text-sm text-[var(--color-text-muted)]">{titleCase("Loading...")}</p>
              ) : !activity || activity.length === 0 ? (
                <p className="text-sm italic text-[var(--color-text-muted)]">
                  {titleCase("No activity found.")}
                </p>
              ) : (
                activity.map((item) => (
                  <div
                    key={item.id}
                    role={item.threadId ? "button" : undefined}
                    tabIndex={item.threadId ? 0 : undefined}
                    onClick={() => item.threadId && setOpenThreadId(item.threadId)}
                    onKeyDown={(e) => {
                      if (item.threadId && (e.key === "Enter" || e.key === " ")) setOpenThreadId(item.threadId);
                    }}
                    className={`flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${
                      item.threadId ? "cursor-pointer hover:bg-[var(--color-surface-offset)]" : ""
                    }`}
                  >
                    <IconMenu className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[var(--color-text)]">{item.from}</p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                      {new Date(item.date).toLocaleDateString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "Emails" && (
            <div className="space-y-3">
              <form onSubmit={handleEmailSearchSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
                  <input
                    data-testid="crm-company-email-search"
                    type="text"
                    value={emailSearchInput}
                    onChange={(e) => setEmailSearchInput(e.target.value)}
                    placeholder={titleCase("Search these emails...")}
                    className="input-field h-9 w-full pl-8 text-sm"
                  />
                </div>
                <button type="submit" className="btn-ghost px-3 py-1.5 text-sm">
                  {titleCase("Search")}
                </button>
              </form>

              {tabLoading && emails === null ? (
                <p className="text-sm text-[var(--color-text-muted)]">{titleCase("Loading...")}</p>
              ) : !emails || emails.length === 0 ? (
                <p className="text-sm italic text-[var(--color-text-muted)]">
                  {titleCase("No emails found.")}
                </p>
              ) : (
                emails.map((item) => (
                  <div
                    key={item.id}
                    role={item.threadId ? "button" : undefined}
                    tabIndex={item.threadId ? 0 : undefined}
                    onClick={() => item.threadId && setOpenThreadId(item.threadId)}
                    onKeyDown={(e) => {
                      if (item.threadId && (e.key === "Enter" || e.key === " ")) setOpenThreadId(item.threadId);
                    }}
                    className={`rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${
                      item.threadId ? "cursor-pointer hover:bg-[var(--color-surface-offset)]" : ""
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 truncate text-sm font-semibold text-[var(--color-text)]">
                        <IconMail className="h-3.5 w-3.5 shrink-0" />
                        {item.subject || titleCase("(no subject)")}
                      </span>
                      <time className="shrink-0 text-xs font-medium text-[var(--color-primary)]">
                        {new Date(item.date).toLocaleDateString()}
                      </time>
                    </div>
                    <p className="truncate text-xs text-[var(--color-text-muted)]">{item.from}</p>
                    {item.snippet && (
                      <p className="mt-1 max-h-9 overflow-hidden text-xs text-[var(--color-text-muted)]">
                        {item.snippet}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "Notes" && (
            <div className="space-y-4">
              <form onSubmit={handleAddNote} className="space-y-2">
                <textarea
                  data-testid="crm-company-note-input"
                  required
                  rows={3}
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder={titleCase("Add a note about this company...")}
                  className="input-field h-auto resize-none py-2 text-sm"
                />
                <button
                  type="submit"
                  data-testid="crm-company-note-submit"
                  disabled={submittingNote}
                  className="btn-primary py-1.5 text-sm disabled:opacity-60"
                >
                  {titleCase(submittingNote ? "Saving..." : "Add note")}
                </button>
              </form>

              <div className="space-y-2">
                {tabLoading && notes === null ? (
                  <p className="text-sm text-[var(--color-text-muted)]">{titleCase("Loading...")}</p>
                ) : !notes || notes.length === 0 ? (
                  <p className="text-sm italic text-[var(--color-text-muted)]">
                    {titleCase("No notes yet.")}
                  </p>
                ) : (
                  notes.map((n) => (
                    <div
                      key={n.id}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
                    >
                      <p className="whitespace-pre-wrap text-sm text-[var(--color-text)]">{n.body}</p>
                      <time className="mt-1 block text-xs text-[var(--color-text-muted)]">
                        {new Date(n.created_at).toLocaleString()}
                      </time>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {openThreadId && (
        <ThreadPreviewModal threadId={openThreadId} onClose={() => setOpenThreadId(null)} />
      )}
    </div>
  );
}

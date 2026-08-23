"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RefreshCw, Search, Settings, UserPlus } from "lucide-react";
import { GmailAvatar } from "@/components/GmailAvatar";
import { IconBuilding, IconLinkedin } from "@/components/Icons";
import { CompanyLogo } from "@/components/CompanyLogo";
import { CONNECTION_STRENGTH_DOT } from "@/lib/connection-strength-ui";
import type { ConnectionStrengthSettings, EmailConnectionStrength } from "@/lib/email-connection-strength";
import type { DirectoryContactInput } from "@/hooks/useDirectoryContacts";
import { requestContactSyncRun, requestContactSyncStop, useContactSyncSnapshot } from "@/lib/contact-sync-store";
import { linkedInSearchUrl, personNameForSearch } from "@/lib/contact-directory";
import { titleCase } from "@/lib/title-case";
import { timeAgo, truncateChars } from "@/lib/utils";
import type { SyncedCompanyRow } from "@/app/api/synced-contacts/companies/route";
import { SyncedPersonModal } from "@/components/SyncedPersonModal";
import { SyncedCompanyModal } from "@/components/SyncedCompanyModal";
import { ConnectionStrengthSettingsModal } from "@/components/ConnectionStrengthSettingsModal";
import { SimpleDropdown, type DropdownOption } from "@/components/SimpleDropdown";

type SyncedContactRow = {
  id: string;
  email: string;
  display_name: string | null;
  domain: string | null;
  company_name: string | null;
  last_interaction_at: string | null;
  connection_strength: EmailConnectionStrength | null;
  message_count_90d: number;
  message_count_total: number;
  synced_at: string | null;
};

const BUCKET_ORDER: EmailConnectionStrength[] = ["Good", "Weak", "Very weak", "No communication"];

type StrengthFilter = "all" | EmailConnectionStrength;

const STRENGTH_OPTIONS: DropdownOption<StrengthFilter>[] = [
  { value: "all", label: "All" },
  ...BUCKET_ORDER.map((tier) => ({ value: tier, label: tier })),
];

type ViewMode = "people" | "companies";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Both lists here are deliberately *not* part of the eager login-time prefetch
 * chain (unlike Team Directory) — this data only needs to be fresh right after
 * an explicit "Sync from Mailbox" run, so a simple fetch-once-then-cache
 * (invalidated by the sync-finished effect below) is enough; no benefit to
 * always-revalidating on every mount.
 */
let contactsCache: SyncedContactRow[] | null = null;
let companiesCache: SyncedCompanyRow[] | null = null;

/**
 * Prefetched alongside the contacts list (not on-demand when the settings
 * modal opens) so opening it is instant instead of showing its own "Loading…"
 * every time — the previous version fetched fresh on every open.
 */
export let strengthSettingsCache: { settings: ConnectionStrengthSettings; isDefault: boolean } | null = null;

/**
 * People + Companies auto-derived from the shared mailbox, read-only, re-syncable.
 * Companies are just a `GROUP BY domain` over the same synced_contacts rows (see
 * app/api/synced-contacts/companies/route.ts) — no separate enrichment step. The
 * actual sync runs in ContactSyncStatus (mounted in AppShell, survives navigation)
 * — this section just requests a run and reflects the same shared state, so a sync
 * started here keeps going (and stays visible) even after leaving this page.
 */
export function SyncedContactsSection({
  onAddToDirectory,
}: {
  onAddToDirectory: (input: DirectoryContactInput) => void;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>("people");
  const [contacts, setContacts] = useState<SyncedContactRow[]>(contactsCache ?? []);
  const [loading, setLoading] = useState(contactsCache === null);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<SyncedCompanyRow[]>(companiesCache ?? []);
  const [companiesLoaded, setCompaniesLoaded] = useState(companiesCache !== null);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>("all");
  const [strengthSettingsOpen, setStrengthSettingsOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<SyncedContactRow | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<SyncedCompanyRow | null>(null);
  const sync = useContactSyncSnapshot();
  const wasRunningRef = useRef(false);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/synced-contacts");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load synced contacts");
      const rows = json.contacts || [];
      contactsCache = rows;
      setContacts(rows);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCompanies = useCallback(async () => {
    setCompaniesLoading(true);
    setCompaniesError(null);
    try {
      const res = await fetch("/api/synced-contacts/companies");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load companies");
      const rows = json.companies || [];
      companiesCache = rows;
      setCompanies(rows);
      setCompaniesLoaded(true);
    } catch (e) {
      setCompaniesError(errMessage(e));
    } finally {
      setCompaniesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (contactsCache !== null) return;
    void loadContacts();
  }, [loadContacts]);

  // Prefetched once so opening the settings modal is instant rather than
  // showing its own "Loading…" every time.
  useEffect(() => {
    if (strengthSettingsCache !== null) return;
    (async () => {
      try {
        const res = await fetch("/api/user-settings/connection-strength");
        const json = await res.json().catch(() => ({}));
        if (res.ok) strengthSettingsCache = { settings: json.settings, isDefault: json.isDefault };
      } catch {
        /* the modal falls back to fetching on open if this didn't land */
      }
    })();
  }, []);

  // Companies is a secondary view — fetch lazily on first switch rather than always.
  useEffect(() => {
    if (viewMode === "companies" && !companiesLoaded && !companiesLoading) {
      void loadCompanies();
    }
  }, [viewMode, companiesLoaded, companiesLoading, loadCompanies]);

  // Reload both lists whenever a sync run — started here or from another tab — just finished.
  useEffect(() => {
    if (sync.status === "running") {
      wasRunningRef.current = true;
    } else if (wasRunningRef.current && sync.status !== "loading") {
      wasRunningRef.current = false;
      void loadContacts();
      if (companiesLoaded) void loadCompanies();
    }
  }, [sync.status, loadContacts, loadCompanies, companiesLoaded]);

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = contacts;
    if (strengthFilter !== "all") {
      rows = rows.filter((c) => (c.connection_strength ?? "No communication") === strengthFilter);
    }
    if (!q) return rows;
    return rows.filter((c) => {
      return (
        (c.display_name ?? "").toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.company_name ?? "").toLowerCase().includes(q) ||
        (c.domain ?? "").toLowerCase().includes(q)
      );
    });
  }, [contacts, search, strengthFilter]);

  const buckets = useMemo(() => {
    const groups = new Map<EmailConnectionStrength, SyncedContactRow[]>();
    for (const c of filteredContacts) {
      const key = c.connection_strength ?? "No communication";
      const list = groups.get(key) ?? [];
      list.push(c);
      groups.set(key, list);
    }
    return BUCKET_ORDER.map((tier) => ({ tier, rows: groups.get(tier) ?? [] })).filter(
      (b) => b.rows.length > 0
    );
  }, [filteredContacts]);

  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (c) => c.companyName.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q)
    );
  }, [companies, search]);

  const syncing = sync.status === "running";
  // A paused sync keeps its cursor server-side and stays paused until this
  // button explicitly resumes it — nothing else, including a reload, a tab
  // switch or the cron job, restarts it.
  const paused = sync.status === "paused";

  // Gmail's resultSizeEstimate for this backfill's (date-bounded) query. It's an
  // estimate, so the bar is capped at 99% while work continues — overshooting to
  // a full bar that then keeps going is worse than arriving slightly late.
  const syncPercent =
    sync.phase === "backfill" && sync.messagesTotalEstimate && sync.messagesTotalEstimate > 0
      ? Math.min(99, Math.round((sync.messagesScanned / sync.messagesTotalEstimate) * 100))
      : null;

  const statusLine = syncing
    ? titleCase(
        sync.phase === "incremental"
          ? "Syncing new mail…"
          : syncPercent !== null
            ? `Scanning mailbox — ${sync.messagesScanned.toLocaleString()} of about ${sync.messagesTotalEstimate?.toLocaleString()} emails (${syncPercent}%)…`
            : `Scanning mailbox — ${sync.messagesScanned.toLocaleString()} emails so far…`
      )
    : paused
      ? titleCase(
          `Paused at ${sync.messagesScanned} emails — resume to continue from here.`
        )
      : sync.error ||
        sync.summary ||
        titleCase(
          viewMode === "people"
            ? "Bucketed by how recently and often you've emailed each person."
            : "Grouped by email domain — no separate enrichment step."
        );

  return (
    <div className="space-y-4 border-t border-[var(--color-border)] pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">
            {titleCase("Auto-synced from mail")}
          </h2>
          <p
            className={`mt-0.5 text-[12px] ${
              !syncing && sync.error ? "text-[var(--color-danger)]" : "text-[var(--color-text-muted)]"
            }`}
          >
            {statusLine}
          </p>
        </div>
        <button
          data-testid="synced-contacts-sync-btn"
          type="button"
          onClick={() => (syncing ? requestContactSyncStop() : requestContactSyncRun())}
          className="btn-ghost inline-flex shrink-0 items-center gap-1.5 px-3"
        >
          {syncing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : paused ? (
            <Play className="h-3.5 w-3.5" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {titleCase(
            syncing ? "Pause syncing" : paused ? "Resume syncing" : "Sync from mailbox"
          )}
        </button>
      </div>

      {syncing && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-offset)]">
          {syncPercent === null ? (
            // No denominator to work with (incremental runs, or the first page
            // hasn't returned yet). A full-width pulse reads as "working"; a
            // part-width one reads as a percentage, which is what made the old
            // fixed 40% bar look permanently stuck midway.
            <div className="h-full w-full animate-pulse rounded-full bg-[var(--color-copper)]" />
          ) : (
            <div
              className="h-full rounded-full bg-[var(--color-copper)] transition-[width] duration-700 ease-out"
              style={{ width: `${syncPercent}%` }}
            />
          )}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => void loadContacts()}>
            Retry
          </button>
        </div>
      )}

      <div className="inline-flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-offset)] p-1">
        {(["people", "companies"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            data-testid={`synced-view-${mode}`}
            onClick={() => setViewMode(mode)}
            className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
              viewMode === mode
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            {titleCase(mode === "people" ? "People" : "Companies")}
          </button>
        ))}
      </div>

      {(viewMode === "people" ? contacts.length > 0 : companies.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
            <input
              data-testid="synced-contacts-search-input"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={titleCase(
                viewMode === "people" ? "Search by name, company, or email" : "Search by company"
              )}
              className="input-field w-full pl-9 text-[13px]"
            />
          </div>
          {viewMode === "people" && (
            <>
              <SimpleDropdown
                label="Strength"
                value={strengthFilter}
                options={STRENGTH_OPTIONS}
                onChange={setStrengthFilter}
              />
              <button
                type="button"
                title={titleCase("Connection strength settings")}
                onClick={() => setStrengthSettingsOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-copper)] hover:text-[var(--color-copper)]"
              >
                <Settings className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      )}

      {strengthSettingsOpen && (
        <ConnectionStrengthSettingsModal
          initial={strengthSettingsCache}
          onClose={() => setStrengthSettingsOpen(false)}
          onSaved={(next) => {
            strengthSettingsCache = next;
            void loadContacts();
          }}
        />
      )}

      {viewMode === "companies" ? (
        companiesError ? (
          <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
            {companiesError}
            <button type="button" className="ml-3 underline" onClick={() => void loadCompanies()}>
              Retry
            </button>
          </div>
        ) : companiesLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="surface-card h-16 animate-pulse p-4" />
            ))}
          </div>
        ) : companies.length === 0 ? (
          <div className="surface-card p-6 text-center">
            <p className="text-[13px] text-[var(--color-text-muted)]">
              {titleCase("No synced companies yet — sync your mailbox to auto-populate this list.")}
            </p>
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="surface-card p-6 text-center">
            <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("No matches.")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredCompanies.map((c) => (
              <div
                key={c.domain}
                data-testid={`synced-company-${c.domain}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedCompany(c)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedCompany(c);
                  }
                }}
                className="surface-card flex cursor-pointer items-start gap-3 p-3.5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-offset)]">
                  <CompanyLogo logoUrl={c.logoUrl} size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[var(--color-text)]">
                    {truncateChars(c.companyName, 24)}
                  </p>
                  <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                    {c.contactCount} {titleCase(c.contactCount === 1 ? "contact" : "contacts")}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--color-text-faint)]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT[c.bestConnectionStrength]}`} />
                    {titleCase(c.bestConnectionStrength)}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--color-text-faint)]">
                  {c.lastInteractionAt ? timeAgo(c.lastInteractionAt) : titleCase("No contact")}
                </span>
              </div>
            ))}
          </div>
        )
      ) : loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="surface-card h-16 animate-pulse p-4" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="surface-card p-6 text-center">
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {titleCase("No synced contacts yet — sync your mailbox to auto-populate this list.")}
          </p>
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="surface-card p-6 text-center">
          <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("No matches.")}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {buckets.map(({ tier, rows }) => (
            <div key={tier} className="space-y-2.5">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT[tier]}`} />
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {titleCase(tier)} · {rows.length}
                </h3>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {rows.map((c) => (
                  <div
                    key={c.id}
                    data-testid={`synced-card-${c.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedPerson(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedPerson(c);
                      }
                    }}
                    className="surface-card flex cursor-pointer items-start gap-3 p-3.5"
                  >
                    <GmailAvatar seed={c.email} name={c.display_name || c.email} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-[var(--color-text)]">
                        {truncateChars(c.display_name || c.email, 22)}
                      </p>
                      <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                        {truncateChars(c.email, 26)}
                      </p>
                      {c.company_name && (
                        <p className="mt-0.5 flex items-center gap-1 text-[12px] text-[var(--color-text-faint)]">
                          <IconBuilding className="h-3 w-3 shrink-0" />
                          <span className="min-w-0 truncate">{truncateChars(c.company_name, 22)}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <a
                        data-testid={`synced-linkedin-${c.id}`}
                        href={linkedInSearchUrl(personNameForSearch(c.display_name, c.email), c.company_name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="btn-ghost inline-flex h-7 w-7 items-center justify-center rounded-lg p-0"
                        title={titleCase("Find on LinkedIn")}
                        aria-label={titleCase("Find on LinkedIn")}
                      >
                        <IconLinkedin className="h-3.5 w-3.5" />
                      </a>
                      <button
                        data-testid={`synced-add-${c.id}`}
                        type="button"
                        className="btn-ghost inline-flex h-7 w-7 items-center justify-center rounded-lg p-0"
                        title={titleCase("Add to directory")}
                        aria-label={titleCase("Add to directory")}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToDirectory({
                            name: c.display_name || c.email,
                            company: c.company_name ?? "",
                            email: c.email,
                          });
                        }}
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPerson && (
        <SyncedPersonModal
          contact={selectedPerson}
          onClose={() => setSelectedPerson(null)}
          onAddToDirectory={onAddToDirectory}
        />
      )}

      {selectedCompany && (
        <SyncedCompanyModal
          company={selectedCompany}
          people={contacts.filter((c) => (c.domain ?? "").toLowerCase() === selectedCompany.domain)}
          onClose={() => setSelectedCompany(null)}
          onOpenPerson={(person) => {
            setSelectedCompany(null);
            setSelectedPerson(person);
          }}
          onAddToDirectory={onAddToDirectory}
        />
      )}
    </div>
  );
}

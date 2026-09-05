"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RefreshCw, Search, Settings, UserPlus } from "lucide-react";
import { GmailAvatar } from "@/components/GmailAvatar";
import { IconBuilding, IconLinkedin } from "@/components/Icons";
import { CompanyLogo } from "@/components/CompanyLogo";
import { CONNECTION_STRENGTH_DOT } from "@/lib/connection-strength-ui";
import type { EmailConnectionStrength } from "@/lib/email-connection-strength";
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
import { ShowMoreRow, useBucketLimit } from "@/components/BucketRowLimit";
import {
  getSyncedContactsCache,
  setStrengthSettingsCache,
  setSyncedContactsCache,
  useSyncedContactsCache,
  useStrengthSettingsCache,
  warmSyncedContacts,
  type SyncedContactRow,
} from "@/lib/synced-contacts-prefetch";

const BUCKET_ORDER: EmailConnectionStrength[] = ["Good", "Weak", "Very weak", "No communication"];

/** Stable reference for the pre-warm state — `cachedContacts ?? []` inline would
 *  allocate a new array every render and defeat the useMemo below it depends on. */
const EMPTY_CONTACTS: SyncedContactRow[] = [];

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
 * The People list + its connection-strength settings live in
 * lib/synced-contacts-prefetch.ts, not as module state here — ContactDirectory
 * calls warmSyncedContacts() as soon as the Contacts page mounts (regardless
 * of whether this section is expanded), so the fetch is usually already done
 * by the time this component exists at all. This file just reads/writes that
 * shared cache.
 *
 * Companies stays local: it's a secondary view *within* this already-secondary
 * section, fetched lazily on first switch — no benefit to warming it early.
 */
let companiesCache: SyncedCompanyRow[] | null = null;

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
  // Reactive read of the shared cache (lib/synced-contacts-prefetch.ts) —
  // warmed by ContactDirectory on mount, so this is usually already populated
  // by the time a user opens this section; re-renders automatically if a
  // warm/reload lands after mount.
  const cachedContacts = useSyncedContactsCache();
  const contacts = cachedContacts ?? EMPTY_CONTACTS;
  const [refreshing, setRefreshing] = useState(false);
  const loading = cachedContacts === null || refreshing;
  const [error, setError] = useState<string | null>(null);
  const strengthSettings = useStrengthSettingsCache();
  const [companies, setCompanies] = useState<SyncedCompanyRow[]>(companiesCache ?? []);
  const [companiesLoaded, setCompaniesLoaded] = useState(companiesCache !== null);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>("all");
  const [strengthSettingsOpen, setStrengthSettingsOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<SyncedContactRow | null>(null);
  const [selectedCompany, setSelectedCompany] = useState<SyncedCompanyRow | null>(null);
  const { limitFor, showMore } = useBucketLimit();
  const sync = useContactSyncSnapshot();
  const wasRunningRef = useRef(false);

  const loadContacts = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/synced-contacts");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load synced contacts");
      // Writes to the shared cache; useSyncedContactsCache() picks it up via
      // the module's pub-sub, so `contacts` above updates without local state.
      setSyncedContactsCache(json.contacts || []);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  /**
   * `silent` skips the loading/error state entirely — for the automatic
   * refresh after a mailbox sync finishes (below), which must not blank an
   * already-rendered grid back to a skeleton just because a background
   * refetch started. Same fix as the People list's move to
   * fetchSyncedContacts in lib/synced-contacts-prefetch.ts; kept local here
   * since Companies is a lazy, section-local view rather than a warmed cache.
   * A manual "Retry" click or the first switch to this tab still wants the
   * ordinary loading/error UI, so those keep calling this without the flag.
   */
  const loadCompanies = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setCompaniesLoading(true);
      setCompaniesError(null);
    }
    try {
      const res = await fetch("/api/synced-contacts/companies");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load companies");
      const rows = json.companies || [];
      companiesCache = rows;
      setCompanies(rows);
      setCompaniesLoaded(true);
    } catch (e) {
      if (!silent) setCompaniesError(errMessage(e));
    } finally {
      if (!silent) setCompaniesLoading(false);
    }
  }, []);

  // warmSyncedContacts() is idempotent — a no-op if ContactDirectory's
  // mount-time call already warmed or is warming the cache, and it fails
  // silently by design (best-effort background prefetch). If it's still
  // empty a few seconds after this section actually became visible, fall
  // back to this component's own request so a failed/slow warm shows a real
  // error instead of an indefinite skeleton.
  useEffect(() => {
    warmSyncedContacts();
    const timeout = window.setTimeout(() => {
      // Imperative getter, not the reactive `cachedContacts` above — this
      // runs once, 5s after mount, and must see the *current* cache rather
      // than whatever was captured in this effect's closure at mount time.
      if (getSyncedContactsCache() === null) void loadContacts();
    }, 5000);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Companies is a secondary view — fetch lazily on first switch rather than always.
  useEffect(() => {
    if (viewMode === "companies" && !companiesLoaded && !companiesLoading) {
      void loadCompanies();
    }
  }, [viewMode, companiesLoaded, companiesLoading, loadCompanies]);

  // Companies-only: the People list's own invalidation-on-sync-finish is now
  // armed globally (armSyncedContactsInvalidation, called from
  // ContactDirectory) so it keeps working while this section is collapsed —
  // doing it here too would double-fetch People every time a sync finishes
  // while this section happens to be open. Companies has no such global
  // watcher (it's lazy-loaded and only relevant while this view is showing),
  // so it still reloads itself here.
  useEffect(() => {
    if (sync.status === "running") {
      wasRunningRef.current = true;
    } else if (wasRunningRef.current && sync.status !== "loading") {
      wasRunningRef.current = false;
      if (companiesLoaded) void loadCompanies({ silent: true });
    }
  }, [sync.status, loadCompanies, companiesLoaded]);

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
    let rows = companies;
    if (strengthFilter !== "all") {
      rows = rows.filter((c) => c.bestConnectionStrength === strengthFilter);
    }
    if (!q) return rows;
    return rows.filter(
      (c) => c.companyName.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q)
    );
  }, [companies, search, strengthFilter]);

  const companyBuckets = useMemo(() => {
    const groups = new Map<EmailConnectionStrength, SyncedCompanyRow[]>();
    for (const c of filteredCompanies) {
      const list = groups.get(c.bestConnectionStrength) ?? [];
      list.push(c);
      groups.set(c.bestConnectionStrength, list);
    }
    return BUCKET_ORDER.map((tier) => ({ tier, rows: groups.get(tier) ?? [] })).filter(
      (b) => b.rows.length > 0
    );
  }, [filteredCompanies]);

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
            : "Grouped by email domain, bucketed by your strongest contact there."
        );

  return (
    // No heading or top border of its own: the caller (ContactDirectory) now
    // renders this inside a collapsible card that supplies both.
    <div className="space-y-4 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p
            className={`text-[12px] ${
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
        </div>
      )}

      {strengthSettingsOpen && (
        <ConnectionStrengthSettingsModal
          initial={strengthSettings}
          onClose={() => setStrengthSettingsOpen(false)}
          onSaved={(next) => {
            setStrengthSettingsCache(next);
            void loadContacts();
            if (companiesLoaded) void loadCompanies();
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
          <div className="space-y-5">
            {companyBuckets.map(({ tier, rows }) => (
              <div key={tier} className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT[tier]}`} />
                  <h3 className="text-[12px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                    {titleCase(tier)} · {rows.length}
                  </h3>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {rows.slice(0, limitFor(`co:${tier}`)).map((c) => (
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
                      <CompanyLogo logoUrl={c.logoUrl} size={40} fill />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-[var(--color-text)]">
                          {truncateChars(c.companyName, 24)}
                        </p>
                        <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                          {c.contactCount} {titleCase(c.contactCount === 1 ? "contact" : "contacts")}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] text-[var(--color-text-faint)]">
                        {c.lastInteractionAt ? timeAgo(c.lastInteractionAt) : titleCase("No contact")}
                      </span>
                    </div>
                  ))}
                </div>
                <ShowMoreRow
                  shown={Math.min(limitFor(`co:${tier}`), rows.length)}
                  total={rows.length}
                  onShowMore={() => showMore(`co:${tier}`)}
                />
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
                {rows.slice(0, limitFor(`p:${tier}`)).map((c) => (
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
              <ShowMoreRow
                shown={Math.min(limitFor(`p:${tier}`), rows.length)}
                total={rows.length}
                onShowMore={() => showMore(`p:${tier}`)}
              />
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

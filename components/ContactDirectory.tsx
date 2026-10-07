"use client";

import Link from "next/link";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Search, Trash2, Upload, UserRound } from "lucide-react";
import { GmailAvatar } from "@/components/GmailAvatar";
import { IconLinkedin, IconWhatsAppLogo } from "@/components/Icons";
import { SyncedContactsSection } from "@/components/SyncedContactsSection";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContactFormModal, contactToFormInput, emptyContactForm } from "@/components/ContactFormModal";
import { ContactImportModal } from "@/components/ContactImportModal";
import { useDirectoryContacts, type DirectoryContactInput } from "@/hooks/useDirectoryContacts";
import { armSyncedContactsInvalidation, warmSyncedContacts } from "@/lib/synced-contacts-prefetch";
import { useModuleVisibility } from "@/lib/module-visibility";
import { contactLinkedInSearchUrl, type DirectoryContact } from "@/lib/contact-directory";
import { formatPhone } from "@/lib/phone-contacts-display";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type SortKey = "last_contacted" | "name" | "company";
type Toast = { kind: "success" | "error"; text: string };
const ALL = "All";

/** Rows per page of the directory table. */
const PAGE_SIZE = 10;

/** Page numbers to show: first, last and the current page's neighbours, with null marking a gap. */
function pageWindow(current: number, total: number): (number | null)[] {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sortedPages = Array.from(pages).filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sortedPages.forEach((n, i) => {
    if (i > 0 && n - sortedPages[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

/** Remembers whether the auto-synced section was left open, per browser. */
const SYNCED_OPEN_KEY = "contacts:synced-open";

function statusLabel(c: DirectoryContact): string {
  return c.lead_stage ? titleCase(c.lead_stage) : titleCase("Not in pipeline");
}

function statusClasses(c: DirectoryContact): string {
  if (!c.lead_stage) return "bg-[var(--color-surface-offset)] text-[var(--color-text-faint)]";
  if (c.lead_score === "Hot") return "bg-[var(--color-danger)]/10 text-[var(--color-danger)]";
  if (c.lead_score === "Cold") return "bg-[var(--color-text-faint)]/15 text-[var(--color-text-muted)]";
  return "bg-[var(--color-warning-light)] text-[var(--color-warning)]";
}

/**
 * The board column defines its own colour, so tint the chip with it — the same
 * classification should look the same in both places. Falls back to the
 * score-based palette for leads with no board column (pre-0054 rows).
 */
function statusStyle(c: DirectoryContact): React.CSSProperties | undefined {
  if (!c.lead_stage || !c.lead_stage_color) return undefined;
  return { backgroundColor: `${c.lead_stage_color}1A`, color: c.lead_stage_color };
}

/** Previous / numbered / Next controls, shown in the strip above the table. */
function Pager({ current, total, onChange }: { current: number; total: number; onChange: (page: number) => void }) {
  return (
    <nav className="flex items-center gap-1" aria-label="Directory pages">
      <button
        type="button"
        data-testid="directory-page-prev"
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
        className="btn-secondary h-8 px-3 text-[12.5px] disabled:opacity-50"
      >
        Previous
      </button>
      {pageWindow(current, total).map((n, i) =>
        n === null ? (
          <span key={`gap-${i}`} className="px-1 text-[12px] text-[var(--color-text-faint)]">
            …
          </span>
        ) : (
          <button
            key={n}
            type="button"
            data-testid={`directory-page-${n}`}
            aria-current={n === current ? "page" : undefined}
            onClick={() => onChange(n)}
            className={cn(
              "h-8 min-w-8 rounded-lg px-2 text-[12.5px] font-semibold transition-colors",
              n === current
                ? "bg-[var(--color-copper)] text-white"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
            )}
          >
            {n}
          </button>
        )
      )}
      <button
        type="button"
        data-testid="directory-page-next"
        disabled={current === total}
        onClick={() => onChange(current + 1)}
        className="btn-secondary h-8 px-3 text-[12.5px] disabled:opacity-50"
      >
        Next
      </button>
    </nav>
  );
}

/** Org-wide contact directory — filterable/sortable table, shared across every signed-in user/admin. */
export function ContactDirectory() {
  // Row action deep-links into the WhatsApp thread for this number; the module
  // ships switched off, so the action follows it.
  const whatsappEnabled = useModuleVisibility().isVisible("whatsapp");
  const router = useRouter();
  const { contacts, loading, error, reload, deleteContact } = useDirectoryContacts();
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState(ALL);
  const [designationFilter, setDesignationFilter] = useState(ALL);
  const [tagFilter, setTagFilter] = useState(ALL);
  const [sortKey, setSortKey] = useState<SortKey>("last_contacted");
  const [formOpen, setFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<DirectoryContact | null>(null);
  const [formPrefill, setFormPrefill] = useState<DirectoryContactInput>(emptyContactForm);
  const [importOpen, setImportOpen] = useState(false);
  /** Contact awaiting delete confirmation. */
  const [pendingDelete, setPendingDelete] = useState<DirectoryContact | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [page, setPage] = useState(1);
  // Starts closed so opening Contacts doesn't pay for the synced list's own
  // fetches and rows. Read from storage in an effect, not a useState
  // initializer, so the server and first client render agree.
  const [syncedOpen, setSyncedOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(SYNCED_OPEN_KEY) === "1") setSyncedOpen(true);
    } catch {
      // Private mode / blocked storage — defaults to closed, which is fine.
    }
  }, []);

  // Starts the auto-synced-from-mail fetch in the background as soon as the
  // Contacts page mounts, whether or not that section is expanded — so
  // opening it usually finds the data already there instead of showing its
  // own "Loading…". This doesn't block anything on this page: the directory
  // table above renders from its own (already-warmed) cache regardless.
  // armSyncedContactsInvalidation is separate and keeps that cache fresh
  // after a mailbox sync finishes even while the section stays collapsed.
  useEffect(() => {
    warmSyncedContacts();
    armSyncedContactsInvalidation();
  }, []);

  function toggleSynced() {
    setSyncedOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SYNCED_OPEN_KEY, next ? "1" : "0");
      } catch {
        // Preference just won't persist; the toggle still works this session.
      }
      return next;
    });
  }

  function showToast(t: Toast) {
    setToast(t);
    window.setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 5000);
  }

  const companyOptions = useMemo(
    () => [ALL, ...Array.from(new Set(contacts.map((c) => c.company).filter((v): v is string => !!v))).sort()],
    [contacts]
  );
  const designationOptions = useMemo(
    () => [ALL, ...Array.from(new Set(contacts.map((c) => c.title).filter((v): v is string => !!v))).sort()],
    [contacts]
  );
  const tagOptions = useMemo(
    () => [ALL, ...Array.from(new Set(contacts.flatMap((c) => c.tags ?? []))).sort()],
    [contacts]
  );

  const hasActiveFilters =
    !!search || companyFilter !== ALL || designationFilter !== ALL || tagFilter !== ALL;

  function clearAllFilters() {
    setSearch("");
    setCompanyFilter(ALL);
    setDesignationFilter(ALL);
    setTagFilter(ALL);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (companyFilter !== ALL && c.company !== companyFilter) return false;
      if (designationFilter !== ALL && c.title !== designationFilter) return false;
      if (tagFilter !== ALL && !(c.tags ?? []).includes(tagFilter)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.company ?? "").toLowerCase().includes(q) ||
        (c.title ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").includes(q)
      );
    });
  }, [contacts, search, companyFilter, designationFilter, tagFilter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    if (sortKey === "name") rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortKey === "company") rows.sort((a, b) => (a.company ?? "").localeCompare(b.company ?? ""));
    else {
      rows.sort((a, b) => (b.last_contacted_at ?? b.updated_at).localeCompare(a.last_contacted_at ?? a.updated_at));
    }
    return rows;
  }, [filtered, sortKey]);

  /**
   * One page of rows at a time. Search, filters and sort still run over the
   * whole directory (it's all loaded), so a search finds a contact on any
   * page — paging only limits what is drawn. The page is clamped so deleting
   * the last row of the last page lands on the new last page, not an empty one.
   */
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visible = useMemo(() => sorted.slice(pageStart, pageStart + PAGE_SIZE), [sorted, pageStart]);

  // A new query starts at its first page, not wherever the last one was left.
  useEffect(() => {
    setPage(1);
  }, [search, companyFilter, designationFilter, tagFilter, sortKey]);

  function openAdd() {
    setEditingContact(null);
    setFormPrefill(emptyContactForm);
    setFormOpen(true);
  }

  function openAddFrom(prefill: DirectoryContactInput) {
    setEditingContact(null);
    setFormPrefill({ ...emptyContactForm, ...prefill });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingContact(null);
  }

  function onSaved(contact: DirectoryContact) {
    showToast({ kind: "success", text: `${contact.name} saved to the directory` });
    closeForm();
    void reload();
  }

  /**
   * Closes the dialog at once — deleteContact already drops the row from the
   * table optimistically, so waiting on the server (auth check, delete, lead
   * cascade) only made the dialog sit on "Removing…". A failure puts the row
   * back by reloading and says why.
   */
  function handleDelete(c: DirectoryContact) {
    setPendingDelete(null);
    deleteContact(c.id).catch((err) => {
      showToast({ kind: "error", text: err instanceof Error ? err.message : "Could not delete contact" });
      void reload();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative min-w-0 flex-1 lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
          <input
            data-testid="directory-search-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={titleCase("Search contacts by name, email, or designation")}
            className="input-field w-full pl-9 text-[13px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid="directory-import-btn"
            type="button"
            className="btn-secondary inline-flex items-center gap-2 px-4"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-4 w-4" />
            {titleCase("Import")}
          </button>
          <button
            data-testid="directory-add-btn"
            type="button"
            className="btn-primary-copper inline-flex items-center gap-2 px-4"
            onClick={openAdd}
          >
            <Plus className="h-4 w-4" />
            {titleCase("Add contact")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
          {titleCase("Filters:")}
        </span>
        <FilterSelect label="Company" value={companyFilter} options={companyOptions} onChange={setCompanyFilter} />
        <FilterSelect label="Designation" value={designationFilter} options={designationOptions} onChange={setDesignationFilter} />
        <FilterSelect label="Tags" value={tagFilter} options={tagOptions} onChange={setTagFilter} />
        {hasActiveFilters && (
          <button
            type="button"
            className="text-[12px] font-semibold text-[var(--color-copper)] hover:underline"
            onClick={clearAllFilters}
          >
            {titleCase("Clear all filters")}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-text-faint)]">
            {titleCase("Sort:")}
          </span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="input-field h-8 text-[12px]"
          >
            <option value="last_contacted">{titleCase("Last contacted")}</option>
            <option value="name">{titleCase("Name")}</option>
            <option value="company">{titleCase("Company")}</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
          <button type="button" className="ml-3 underline" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}

      <div className="surface-card overflow-hidden p-0">
        {loading ? (
          <div className="divide-y divide-[var(--color-border)]">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <div className="h-10 w-10 animate-pulse rounded-full bg-[var(--color-surface-offset)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-[var(--color-surface-offset)]" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-[var(--color-surface-offset)]" />
                </div>
              </div>
            ))}
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-offset)]">
              <UserRound className="h-7 w-7 text-[var(--color-text-faint)]" />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-[var(--color-text)]">
              {titleCase("No contacts in the directory yet")}
            </p>
            <p className="mt-1 max-w-sm text-[13px] text-[var(--color-text-muted)]">
              Add a contact card and it will be visible to every teammate and admin.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              <button type="button" className="btn-primary-copper inline-flex items-center gap-2" onClick={openAdd}>
                <Plus className="h-4 w-4" />
                {titleCase("Add your first contact")}
              </button>
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="h-4 w-4" />
                {titleCase("Import from CSV / Excel")}
              </button>
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <p className="p-8 text-center text-[13px] text-[var(--color-text-muted)]">
            {titleCase("No contacts match your search or filters.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            {sorted.length > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-2">
                <span className="text-[12px] text-[var(--color-text-muted)]">
                  {pageStart + 1}–{pageStart + visible.length} of {sorted.length.toLocaleString()}
                </span>
                <Pager current={currentPage} total={totalPages} onChange={setPage} />
              </div>
            )}
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="px-4 py-3">{titleCase("Full name")}</th>
                  <th className="px-4 py-3">{titleCase("Company")}</th>
                  <th className="px-4 py-3">{titleCase("Designation")}</th>
                  <th className="px-4 py-3">{titleCase("Email")}</th>
                  <th className="px-4 py-3">{titleCase("Status")}</th>
                  {/* "Last contacted" column hidden for now; the data and sort option remain. */}
                  <th className="px-4 py-3">{titleCase("Links")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr
                    key={c.id}
                    data-testid={`directory-row-${c.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => router.push(`/contacts/${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") router.push(`/contacts/${c.id}`);
                    }}
                    className="cursor-pointer border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <GmailAvatar seed={c.email || c.id} name={c.name} size={36} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-[var(--color-text)]">{c.name}</p>
                          {c.phone && (
                            <p className="truncate text-[12px] text-[var(--color-text-muted)]">{formatPhone(c.phone)}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.company || "—"}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.title || "—"}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{c.email || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {/* inline-block + nowrap: as an inline element the chip
                          wrapped across two lines in a narrow column, which
                          fragments the rounded background into two offset
                          boxes and overlaps the neighbouring row. */}
                      <span
                        className={cn(
                          "inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          !statusStyle(c) && statusClasses(c)
                        )}
                        style={statusStyle(c)}
                      >
                        {statusLabel(c)}
                      </span>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <a
                          href={c.linkedin_url || contactLinkedInSearchUrl(c)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-faint)] transition-colors hover:bg-[#0A66C2]/10 hover:text-[var(--color-text)]"
                          title={titleCase("LinkedIn")}
                        >
                          <IconLinkedin className="h-4 w-4" />
                        </a>
                        {c.phone && whatsappEnabled && (
                          <Link
                            href={`/whatsapp?peer=${encodeURIComponent(c.phone)}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[#25D366]/10"
                            title={titleCase("WhatsApp")}
                          >
                            <IconWhatsAppLogo className="h-4 w-4" />
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        data-testid={`directory-delete-${c.id}`}
                        type="button"
                        className="btn-ghost inline-flex h-8 w-8 items-center justify-center rounded-lg p-0 text-[var(--color-danger)]"
                        title={titleCase("Delete")}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(c);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

          </div>
        )}
      </div>

      <div className="surface-card overflow-hidden">
        <button
          type="button"
          data-testid="directory-synced-toggle"
          onClick={toggleSynced}
          aria-expanded={syncedOpen}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--color-surface-offset)]/50"
        >
          <div className="min-w-0">
            <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">
              {titleCase("Auto-synced from mail")}
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
              {titleCase("People and companies derived from your mailbox.")}
            </p>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform",
              syncedOpen && "rotate-180"
            )}
          />
        </button>
        {/* Mounted only when open — this is what keeps its two API calls and
            its own several-thousand-row list off the Contacts page load. */}
        {syncedOpen && (
          <div className="border-t border-[var(--color-border)] px-5 pb-5">
            <SyncedContactsSection onAddToDirectory={openAddFrom} />
          </div>
        )}
      </div>

      {formOpen && (
        <ContactFormModal
          editingId={editingContact?.id}
          initial={editingContact ? contactToFormInput(editingContact) : formPrefill}
          onClose={closeForm}
          onSaved={onSaved}
        />
      )}

      {importOpen && (
        // The dialog reports the outcome itself; the table just needs the new rows.
        <ContactImportModal existing={contacts} onClose={() => setImportOpen(false)} onImported={() => void reload()} />
      )}

      {toast && (
        <div
          className={cn(
            "fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-xl px-4 py-3 text-[13px] font-medium shadow-lg",
            toast.kind === "success"
              ? "border border-[var(--color-success)]/30 bg-[var(--color-success-light)] text-[var(--color-success)]"
              : "border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
          )}
          role="status"
        >
          {toast.text}
        </div>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          tone="danger"
          title="Remove this contact?"
          body={`${pendingDelete.name} will be removed from the team directory.`}
          confirmLabel="Remove contact"
          cancelLabel="Keep it"
          onConfirm={() => handleDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px]">
      <span className="text-[var(--color-text-muted)]">{titleCase(label)}:</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-[var(--color-text)] outline-none"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt === ALL ? titleCase("All") : opt}
          </option>
        ))}
      </select>
    </label>
  );
}

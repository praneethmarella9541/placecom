"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, UserRound } from "lucide-react";
import { GmailAvatar } from "@/components/GmailAvatar";
import { IconLinkedin, IconWhatsAppLogo } from "@/components/Icons";
import { SyncedContactsSection } from "@/components/SyncedContactsSection";
import { ContactFormModal, contactToFormInput, emptyContactForm } from "@/components/ContactFormModal";
import { useDirectoryContacts, type DirectoryContactInput } from "@/hooks/useDirectoryContacts";
import { linkedInSearchUrl, type DirectoryContact } from "@/lib/contact-directory";
import { formatPhone } from "@/lib/wa-contacts-display";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

type SortKey = "last_contacted" | "name" | "company";
type Toast = { kind: "success" | "error"; text: string };
const ALL = "All";

function statusLabel(c: DirectoryContact): string {
  return c.lead_stage ? titleCase(c.lead_stage) : titleCase("Not in pipeline");
}

function statusClasses(c: DirectoryContact): string {
  if (!c.lead_stage) return "bg-[var(--color-surface-offset)] text-[var(--color-text-faint)]";
  if (c.lead_score === "Hot") return "bg-[var(--color-danger)]/10 text-[var(--color-danger)]";
  if (c.lead_score === "Cold") return "bg-[var(--color-text-faint)]/15 text-[var(--color-text-muted)]";
  return "bg-[var(--color-warning-light)] text-[var(--color-warning)]";
}

/** Org-wide contact directory — filterable/sortable table, shared across every signed-in user/admin. */
export function ContactDirectory() {
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
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

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

  async function handleDelete(c: DirectoryContact, e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Remove ${c.name} from the team directory?`)) return;
    setBusy(true);
    try {
      await deleteContact(c.id);
    } catch (err) {
      showToast({ kind: "error", text: err instanceof Error ? err.message : "Could not delete contact" });
    } finally {
      setBusy(false);
    }
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
            <button type="button" className="btn-primary-copper mt-5 inline-flex items-center gap-2" onClick={openAdd}>
              <Plus className="h-4 w-4" />
              {titleCase("Add your first contact")}
            </button>
          </div>
        ) : sorted.length === 0 ? (
          <p className="p-8 text-center text-[13px] text-[var(--color-text-muted)]">
            {titleCase("No contacts match your search or filters.")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  <th className="px-4 py-3">{titleCase("Full name")}</th>
                  <th className="px-4 py-3">{titleCase("Company")}</th>
                  <th className="px-4 py-3">{titleCase("Designation")}</th>
                  <th className="px-4 py-3">{titleCase("Email")}</th>
                  <th className="px-4 py-3">{titleCase("Status")}</th>
                  <th className="px-4 py-3">{titleCase("Last contacted")}</th>
                  <th className="px-4 py-3">{titleCase("Links")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((c) => (
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
                    <td className="px-4 py-3">
                      <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", statusClasses(c))}>
                        {statusLabel(c)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {new Date(c.last_contacted_at ?? c.updated_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <a
                          href={c.linkedin_url || linkedInSearchUrl(c.name, c.company)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-faint)] transition-colors hover:bg-[#0A66C2]/10 hover:text-[var(--color-text)]"
                          title={titleCase("LinkedIn")}
                        >
                          <IconLinkedin className="h-4 w-4" />
                        </a>
                        {c.phone && (
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
                        disabled={busy}
                        className="btn-ghost inline-flex h-8 w-8 items-center justify-center rounded-lg p-0 text-[var(--color-danger)]"
                        title={titleCase("Delete")}
                        onClick={(e) => void handleDelete(c, e)}
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

      <SyncedContactsSection onAddToDirectory={openAddFrom} />

      {formOpen && (
        <ContactFormModal
          editingId={editingContact?.id}
          initial={editingContact ? contactToFormInput(editingContact) : formPrefill}
          onClose={closeForm}
          onSaved={onSaved}
        />
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

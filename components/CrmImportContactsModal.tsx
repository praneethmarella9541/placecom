"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { IconX } from "@/components/Icons";
import { GmailAvatar } from "@/components/GmailAvatar";
import { useDirectoryContacts } from "@/hooks/useDirectoryContacts";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

/** Rows drawn before "load more" — the directory runs to thousands. */
const PAGE_SIZE = 60;

/** Mirrors MAX_IMPORT in app/api/crm/leads/import/route.ts — the server takes
 *  only the first this-many ids, so "select all" stops here and says so. */
const IMPORT_CAP = 100;

/**
 * Bulk "import from contacts" — the second of the two ways a lead enters the
 * board (the other being the single "Add to CRM" action on a contact card).
 * Importing is deliberately explicit: it's what bounds how much the
 * classifier ever has to read.
 */
export function CrmImportContactsModal({
  onClose,
  onImported,
  existingContactIds,
  existingEmails,
}: {
  onClose: () => void;
  /** Receives the ids of the newly created leads so the caller can classify exactly those. */
  onImported: (leadIds: string[], summary: { created: number; skipped: number }) => void;
  /** directory_contacts ids already on the board (leads.source_contact_id). */
  existingContactIds: Set<string>;
  /** Lowercased emails of existing leads — catches leads added before source_contact_id existed. */
  existingEmails: Set<string>;
}) {
  // Shares the session-wide directory cache the rest of the app warms, rather
  // than re-fetching /api/directory-contacts (the enriched, whole-table
  // endpoint) every time this modal opens.
  const { contacts, loading, error: loadError } = useDirectoryContacts();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [hideExisting, setHideExisting] = useState(true);

  const isOnBoard = useMemo(() => {
    return (c: { id: string; email: string | null }) =>
      existingContactIds.has(c.id) ||
      Boolean(c.email && existingEmails.has(c.email.trim().toLowerCase()));
  }, [existingContactIds, existingEmails]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (hideExisting && isOnBoard(c)) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.company ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [contacts, search, hideExisting, isOnBoard]);

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const alreadyCount = useMemo(() => contacts.filter(isOnBoard).length, [contacts, isOnBoard]);

  // Everything the current search / "hide existing" filter leaves that could
  // actually be imported (rows already on the board can't be) — "select all"
  // acts on this whole set, not just the visible page.
  const selectable = useMemo(() => filtered.filter((c) => !isOnBoard(c)), [filtered, isOnBoard]);
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.id));
  const someSelected = !allSelected && selectable.some((c) => selected.has(c.id));
  const overCap = selectable.length > IMPORT_CAP || selected.size >= IMPORT_CAP;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const c of selectable) next.delete(c.id);
      } else {
        for (const c of selectable) {
          if (next.size >= IMPORT_CAP) break;
          next.add(c.id);
        }
      }
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: Array.from(selected) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Import failed");
      onImported(json.leadIds ?? [], { created: json.created ?? 0, skipped: json.skipped ?? 0 });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crm-import-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id="crm-import-title" className="font-display text-lg font-bold text-[var(--color-text)]">
              {titleCase("Import from contacts")}
            </h2>
            <p className="mt-1 text-[12px] text-[var(--color-text-muted)]">
              {titleCase("Picked contacts become leads, then get classified into columns.")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost -mr-1.5 -mt-0.5 shrink-0 p-1.5"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="shrink-0 space-y-2 px-6 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder={titleCase("Search by name, company, or email")}
              className="input-field w-full pl-9 text-[13px]"
            />
          </div>
          {alreadyCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
              <input
                type="checkbox"
                checked={hideExisting}
                onChange={(e) => {
                  setHideExisting(e.target.checked);
                  setVisibleCount(PAGE_SIZE);
                }}
                className="h-3.5 w-3.5 accent-[var(--color-copper)]"
              />
              {titleCase(`Hide the ${alreadyCount} already on the board`)}
            </label>
          )}
          {selectable.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium text-[var(--color-text)]">
              <input
                type="checkbox"
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                checked={allSelected}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 accent-[var(--color-copper)]"
              />
              {allSelected
                ? titleCase("Clear selection")
                : titleCase(
                    search.trim() || !hideExisting
                      ? `Select all ${Math.min(selectable.length, IMPORT_CAP)} matching`
                      : `Select all ${Math.min(selectable.length, IMPORT_CAP)}`,
                  )}
            </label>
          )}
          {overCap && (
            <p className="text-[11px] text-[var(--color-text-faint)]">
              {titleCase(
                `Up to ${IMPORT_CAP} import at once — bring these in, then search for the rest.`,
              )}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          {loading ? (
            <div className="space-y-2 px-3 py-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton-shimmer h-12 rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-[var(--color-text-muted)]">
              {titleCase(contacts.length === 0 ? "No contacts in the directory yet." : "No matches.")}
            </p>
          ) : (
            <ul className="space-y-1 pb-2">
              {visible.map((c) => {
                const isSelected = selected.has(c.id);
                const onBoard = isOnBoard(c);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={onBoard}
                      onClick={() => toggle(c.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                        onBoard
                          ? "cursor-not-allowed border-transparent opacity-50"
                          : isSelected
                            ? "border-[var(--color-copper)]/40 bg-[var(--color-copper-tint)]"
                            : "border-transparent hover:bg-[var(--color-surface-offset)]"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={onBoard}
                        readOnly
                        tabIndex={-1}
                        className="pointer-events-none h-4 w-4 shrink-0 accent-[var(--color-copper)]"
                      />
                      <GmailAvatar seed={c.email || c.id} name={c.name} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[var(--color-text)]">
                          {c.name}
                        </p>
                        <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                          {[c.company, c.email].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      {onBoard && (
                        <span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--color-surface-offset)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text-muted)]">
                          {titleCase("On board")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
              {visible.length < filtered.length && (
                <li className="flex items-center justify-center gap-3 py-2">
                  <span className="text-[12px] text-[var(--color-text-muted)]">
                    {titleCase(`Showing ${visible.length} of ${filtered.length}`)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                    className="btn-secondary h-8 px-3 text-[12.5px]"
                  >
                    {titleCase("Load more")}
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        {(error || loadError) && (
          <p className="shrink-0 px-6 pb-2 text-[12.5px] text-[var(--color-danger)]">
            {error || loadError}
          </p>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-border)] px-6 py-3.5">
          <span className="text-[12.5px] text-[var(--color-text-muted)]">
            {selected.size > 0 ? `${selected.size} selected` : titleCase("Nothing selected")}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost px-4" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary-copper px-4"
              onClick={() => void submit()}
              disabled={busy || selected.size === 0}
            >
              {busy ? "Importing…" : titleCase(`Import ${selected.size || ""}`.trim())}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

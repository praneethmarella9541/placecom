"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Plus, Search, Upload, X } from "lucide-react";
import type { RecipientSuggestion } from "@/components/RecipientField";
import { recipientMatchesQuery } from "@/lib/email-recipients";
import { GmailAvatar } from "@/components/GmailAvatar";
import type { ComposeVariable } from "@/lib/compose-variables";

export type MassRecipient = {
  /** Lowercased address — the identity of a recipient throughout the flow. */
  email: string;
  name: string;
};

/**
 * Where the campaign's audience comes from. Exactly one is live at a time —
 * the two carry different merge variables (contact-card fields vs spreadsheet
 * columns), so a mixed list would leave half the recipients with placeholders
 * nothing can fill.
 */
export type MassSource = "contacts" | "import";

export type MassImport = {
  fileName: string;
  /** Rows that had a usable email address. */
  count: number;
  /** Rows dropped for a missing/invalid email. */
  skipped?: number;
  /** True when the file was longer than the per-campaign row cap. */
  truncated?: boolean;
  maxRows?: number;
  /** Column headers offered as `{variables}` in the editor. */
  variables: ComposeVariable[];
};

type Props = {
  /**
   * Same suggestion list the compose To field uses (Google contacts +
   * recruiters + addresses seen in threads), so search here finds everyone
   * search there would.
   */
  suggestions: RecipientSuggestion[];
  /**
   * Addresses with a Team Directory card — every merge variable can resolve
   * for these. Badged so a blank preview isn't the first hint that a
   * recipient has no data behind them.
   */
  directoryEmails?: Set<string>;
  /**
   * Addresses known only from the mailbox sync. Name, company and last
   * interaction resolve; job title and phone do not exist in synced data.
   */
  syncedEmails?: Set<string>;
  /**
   * The audience as rendered in the list below — hand-picked contacts, or one
   * entry per imported row.
   */
  selected: MassRecipient[];
  onChange: (next: MassRecipient[]) => void;
  /**
   * Recipient email → variable keys that still resolve to nothing for them,
   * fallbacks included. Flagged in the list so a hole in the merge is visible
   * before the send rather than after, and the flag clears as soon as the
   * fallback (or the contact's data) fills it.
   */
  missingByEmail?: Map<string, string[]>;
  /** Preview mode highlights whose data is currently filled into the draft. */
  activeEmail?: string | null;
  onActiveEmailChange?: (email: string) => void;
  /** Review screen locks the list — recipients are edited back in the editor. */
  readOnly?: boolean;

  source: MassSource;
  onSourceChange: (next: MassSource) => void;
  /** Result of the last successful import; null until a file is loaded. */
  imported: MassImport | null;
  onImportFile: (file: File) => void;
  onClearImport: () => void;
  importBusy?: boolean;
  importError?: string | null;
};

/** Hover text on the per-recipient merge warning. */
const MISSING_DATA_HINT = "Some variables have no value for this recipient";

const TAB_BASE =
  "flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed";

/**
 * Right-hand recipient rail for mass sending.
 *
 * Two mutually exclusive audiences: contacts picked one by one, or a CSV/Excel
 * file whose columns become merge variables. The inactive tab is disabled
 * while the live one holds data — clearing is an explicit act, never a side
 * effect of a tab click that would silently discard a 200-row import.
 */
export function MassRecipientsPanel({
  suggestions,
  directoryEmails,
  syncedEmails,
  selected,
  onChange,
  missingByEmail,
  activeEmail,
  onActiveEmailChange,
  readOnly,
  source,
  onSourceChange,
  imported,
  onImportFile,
  onClearImport,
  importBusy,
  importError,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const selectedEmails = useMemo(
    () => new Set(selected.map((r) => r.email.toLowerCase())),
    [selected]
  );

  // Search-only: an empty box shows nothing rather than dumping the whole
  // address book. Already-added people drop out rather than showing as
  // disabled rows, so every visible result is actionable.
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return suggestions
      .filter((s) => !selectedEmails.has(s.email.toLowerCase()) && recipientMatchesQuery(s, q))
      .slice(0, 10);
  }, [suggestions, selectedEmails, query]);

  function add(s: RecipientSuggestion) {
    const email = s.email.trim().toLowerCase();
    if (!email || selectedEmails.has(email)) return;
    onChange([...selected, { email, name: s.displayName?.trim() || "" }]);
    setQuery("");
  }

  const contactsMode = source === "contacts";
  // Each tab is locked while the *other* source holds the audience.
  const contactsLocked = !contactsMode && !!imported;
  const importLocked = contactsMode && selected.length > 0;

  function switchTo(next: MassSource) {
    if (next === source || importBusy) return;
    if (next === "contacts" && contactsLocked) return;
    if (next === "import" && importLocked) return;
    setPickerOpen(false);
    setQuery("");
    onSourceChange(next);
  }

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-[#e0e0e0] bg-white">
      {!readOnly && (
        <div className="shrink-0 p-3">
          <div
            className="mb-2 flex gap-1 rounded-lg bg-[#f1f3f4] p-1"
            role="tablist"
            aria-label="Recipient source"
          >
            <button
              type="button"
              role="tab"
              aria-selected={contactsMode}
              disabled={contactsLocked || importBusy}
              title={
                contactsLocked ? "Remove the imported file to pick contacts instead" : undefined
              }
              onClick={() => switchTo("contacts")}
              className={`${TAB_BASE} ${
                contactsMode
                  ? "bg-white text-[#202124] shadow-sm"
                  : "text-[#5f6368] enabled:hover:text-[#202124] disabled:text-[#bdc1c6]"
              }`}
            >
              Contacts
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!contactsMode}
              disabled={importLocked || importBusy}
              title={importLocked ? "Remove the recipients below to import a file instead" : undefined}
              onClick={() => switchTo("import")}
              className={`${TAB_BASE} ${
                !contactsMode
                  ? "bg-white text-[#202124] shadow-sm"
                  : "text-[#5f6368] enabled:hover:text-[#202124] disabled:text-[#bdc1c6]"
              }`}
            >
              CSV / Excel
            </button>
          </div>

          {contactsMode ? (
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#dadce0] px-3 py-2.5 text-[13px] font-medium text-[#3c4043] hover:bg-[#f1f3f4]"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Add recipients
            </button>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,.ods"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onImportFile(file);
                }}
              />
              <button
                type="button"
                disabled={importBusy}
                onClick={() => fileRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#dadce0] px-3 py-2.5 text-[13px] font-medium text-[#3c4043] hover:bg-[#f1f3f4] disabled:opacity-60"
              >
                <Upload className="h-4 w-4" strokeWidth={2} />
                {importBusy ? "Reading…" : imported ? "Replace file" : "Import CSV / Excel"}
              </button>

              {importError ? (
                <p className="mt-2 rounded-md bg-[#fce8e6] px-2 py-1.5 text-[11px] leading-snug text-[#c5221f]">
                  {importError}
                </p>
              ) : null}

              {imported ? (
                <div className="mt-2 rounded-lg border border-[#dadce0] p-2">
                  <div className="flex items-start gap-2">
                    <FileSpreadsheet className="mt-px h-4 w-4 shrink-0 text-[#137333]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-[#202124]">
                        {imported.fileName}
                      </span>
                      <span className="block text-[11px] text-[#5f6368]">
                        {imported.count} recipient{imported.count === 1 ? "" : "s"}
                        {imported.skipped ? ` · ${imported.skipped} skipped` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={onClearImport}
                      className="shrink-0 rounded p-0.5 text-[#5f6368] hover:bg-[#e8eaed]"
                      aria-label="Remove imported file"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {imported.truncated ? (
                    <p className="mt-1.5 text-[11px] leading-snug text-[#b06000]">
                      Only the first {imported.maxRows} rows were kept.
                    </p>
                  ) : null}

                  {imported.variables.length > 0 ? (
                    <div className="mt-2 border-t border-[#f1f3f4] pt-2">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#70757a]">
                        Columns — type {"{"} to insert
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {imported.variables.map((v) => (
                          <span
                            key={v.key}
                            title={v.label}
                            className="rounded bg-[#e8f0fe] px-1.5 py-px text-[11px] font-medium text-[#1967d2]"
                          >
                            {`{${v.key}}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-[11px] leading-snug text-[#5f6368]">
                  Row 1 must be column headers, with one column holding email addresses. Every other
                  column becomes a {"{variable}"} you can insert in the subject or body.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {pickerOpen && contactsMode && !readOnly && (
        <div className="shrink-0 border-b border-[#e0e0e0] px-3 pb-3">
          <div className="flex items-center gap-2 rounded-lg bg-[#f1f3f4] px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#5f6368]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search contacts"
              className="w-full bg-transparent text-[13px] text-[#202124] outline-none placeholder:text-[#70757a]"
            />
          </div>

          <div className="scrollbar-thin mt-2 max-h-[240px] overflow-y-auto">
            {!query.trim() ? (
              <p className="px-1 py-3 text-[12px] text-[#5f6368]">
                Start typing to search your contacts.
              </p>
            ) : results.length === 0 ? (
              <p className="px-1 py-3 text-[12px] text-[#5f6368]">
                No contacts match that search.
              </p>
            ) : (
              results.map((s) => (
                <button
                  key={s.email}
                  type="button"
                  onClick={() => add(s)}
                  className="flex w-full items-center gap-2 rounded px-1 py-1.5 text-left hover:bg-[#f1f3f4]"
                >
                  <GmailAvatar
                    seed={s.email}
                    email={s.email}
                    name={s.displayName || s.email}
                    size={24}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 truncate text-[13px] text-[#202124]">
                        {s.displayName || s.email}
                      </span>
                      {directoryEmails?.has(s.email.toLowerCase()) ? (
                        <span
                          title="In Team Directory — every merge variable can fill"
                          className="shrink-0 rounded bg-[#e6f4ea] px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-[#137333]"
                        >
                          Directory
                        </span>
                      ) : syncedEmails?.has(s.email.toLowerCase()) ? (
                        <span
                          title="Auto-synced from mail — name, company and last interaction only"
                          className="shrink-0 rounded bg-[#e8f0fe] px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-[#1967d2]"
                        >
                          Synced
                        </span>
                      ) : null}
                    </span>
                    {s.displayName && (
                      <span className="block truncate text-[11px] text-[#5f6368]">{s.email}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {selected.length === 0 ? (
          <p className="px-1 py-2 text-[12px] leading-snug text-[#5f6368]">
            {contactsMode
              ? "No recipients yet. Add contacts to send this as a campaign."
              : "No recipients yet. Import a CSV or Excel file to send this as a campaign."}
          </p>
        ) : (
          selected.map((r) => {
            const isActive = readOnly && activeEmail?.toLowerCase() === r.email.toLowerCase();
            const missing = missingByEmail?.get(r.email.toLowerCase()) ?? [];
            return (
              <div
                key={r.email}
                role={readOnly ? "button" : undefined}
                tabIndex={readOnly ? 0 : undefined}
                onClick={readOnly ? () => onActiveEmailChange?.(r.email) : undefined}
                onKeyDown={
                  readOnly
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onActiveEmailChange?.(r.email);
                        }
                      }
                    : undefined
                }
                className={`group mb-1 flex items-center gap-2 rounded-lg px-2 py-2 ${
                  isActive ? "bg-[#e8f0fe]" : readOnly ? "cursor-pointer hover:bg-[#f1f3f4]" : ""
                }`}
              >
                <GmailAvatar seed={r.email} email={r.email} name={r.name || r.email} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 truncate text-[13px] font-medium text-[#202124]">
                      {r.name || r.email}
                    </span>
                    {missing.length > 0 ? (
                      // One message for every case — which fields are empty
                      // belongs on the review screen, where they can actually
                      // be filled, not in a tooltip that only reads them out.
                      <span
                        role="img"
                        aria-label={MISSING_DATA_HINT}
                        title={MISSING_DATA_HINT}
                        className="shrink-0 leading-none"
                      >
                        <AlertTriangle
                          className="h-3.5 w-3.5 text-[#b06000]"
                          strokeWidth={2}
                          aria-hidden
                        />
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[11px] text-[#5f6368]">{r.email}</span>
                </span>
                {/* Imported rows are removed by dropping the file, not one at a
                    time — the audience is whatever the spreadsheet says. */}
                {!readOnly && contactsMode && (
                  <button
                    type="button"
                    onClick={() => onChange(selected.filter((s) => s.email !== r.email))}
                    className="shrink-0 rounded p-1 text-[#5f6368] opacity-0 transition-opacity hover:bg-[#e8eaed] group-hover:opacity-100"
                    aria-label={`Remove ${r.name || r.email}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

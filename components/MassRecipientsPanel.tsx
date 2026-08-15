"use client";

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import type { RecipientSuggestion } from "@/components/RecipientField";
import { recipientMatchesQuery } from "@/lib/email-recipients";
import { GmailAvatar } from "@/components/GmailAvatar";

export type MassRecipient = {
  /** Lowercased address — the identity of a recipient throughout the flow. */
  email: string;
  name: string;
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
  selected: MassRecipient[];
  onChange: (next: MassRecipient[]) => void;
  /** Preview mode highlights whose data is currently filled into the draft. */
  activeEmail?: string | null;
  onActiveEmailChange?: (email: string) => void;
  /** Review screen locks the list — recipients are edited back in the editor. */
  readOnly?: boolean;
};

/**
 * Right-hand recipient rail for mass sending. Search adds one recipient per
 * click; the list below is the campaign's audience and mirrors into the To
 * field on the left.
 */
export function MassRecipientsPanel({
  suggestions,
  directoryEmails,
  syncedEmails,
  selected,
  onChange,
  activeEmail,
  onActiveEmailChange,
  readOnly,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

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

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-l border-[#e0e0e0] bg-white">
      {!readOnly && (
        <div className="shrink-0 p-3">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#dadce0] px-3 py-2.5 text-[13px] font-medium text-[#3c4043] hover:bg-[#f1f3f4]"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
            Add recipients
          </button>
        </div>
      )}

      {pickerOpen && !readOnly && (
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
            No recipients yet. Add contacts to send this as a campaign.
          </p>
        ) : (
          selected.map((r) => {
            const isActive = readOnly && activeEmail?.toLowerCase() === r.email.toLowerCase();
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
                  <span className="block truncate text-[13px] font-medium text-[#202124]">
                    {r.name || r.email}
                  </span>
                  <span className="block truncate text-[11px] text-[#5f6368]">{r.email}</span>
                </span>
                {!readOnly && (
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

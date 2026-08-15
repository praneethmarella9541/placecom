"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, Calendar as CalendarIcon, UserPlus, Building2, Paperclip } from "lucide-react";
import { GmailAvatar } from "@/components/GmailAvatar";
import { IconLinkedin, IconX } from "@/components/Icons";
import { EmailThreadPreviewModal } from "@/components/EmailThreadPreviewModal";
import { CONNECTION_STRENGTH_DOT } from "@/lib/connection-strength-ui";
import type { EmailConnectionStrength } from "@/lib/email-connection-strength";
import type { DirectoryContactInput } from "@/hooks/useDirectoryContacts";
import type { TimelineItem } from "@/app/api/directory-contacts/[id]/timeline/route";
import { linkedInSearchUrl, personNameForSearch } from "@/lib/contact-directory";
import { titleCase } from "@/lib/title-case";

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

type Tab = "Emails" | "Meetings";
const TABS: Tab[] = ["Emails", "Meetings"];
const SOURCE_BY_TAB: Record<Tab, "email" | "meeting"> = { Emails: "email", Meetings: "meeting" };

/**
 * Interaction detail for a person auto-synced from the mailbox — same idea as
 * ContactActivityTimeline (for manually-added directory contacts), but backed
 * by /api/synced-contacts/timeline (address-based, not a directory_contacts
 * id) and scoped to Emails/Meetings only — synced contacts don't carry a
 * phone number, so there's nothing to look up for Calls/WhatsApp.
 */
export function SyncedPersonModal({
  contact,
  onClose,
  onAddToDirectory,
}: {
  contact: SyncedContactRow;
  onClose: () => void;
  onAddToDirectory: (input: DirectoryContactInput) => void;
}) {
  const [activeTab, setActiveTab] = useState<Tab>("Emails");
  const [items, setItems] = useState<Partial<Record<"email" | "meeting", TimelineItem[] | "loading" | "error">>>(
    {}
  );
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null);

  const load = useCallback(
    async (type: "email" | "meeting") => {
      setItems((prev) => ({ ...prev, [type]: "loading" }));
      try {
        const res = await fetch(
          `/api/synced-contacts/timeline?${new URLSearchParams({ email: contact.email, source: type }).toString()}`
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to load");
        setItems((prev) => ({ ...prev, [type]: json.items ?? [] }));
      } catch {
        setItems((prev) => ({ ...prev, [type]: "error" }));
      }
    },
    [contact.email]
  );

  useEffect(() => {
    void load("email");
    void load("meeting");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.email]);

  const active = items[SOURCE_BY_TAB[activeTab]];

  if (typeof document === "undefined") return null;

  // Portal to <body> — this can host EmailThreadPreviewModal nested inside
  // it; rendering in place risked its own `fixed inset-0` losing the true
  // viewport as its containing block. See EmailThreadPreviewModal for the
  // full explanation.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <GmailAvatar seed={contact.email} name={contact.display_name || contact.email} size={44} />
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-[var(--color-text)]">
                {contact.display_name || contact.email}
              </h3>
              <p className="truncate text-[13px] text-[var(--color-text-muted)]">{contact.email}</p>
              {contact.company_name && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-[var(--color-text-faint)]">
                  <Building2 className="h-3 w-3 shrink-0" />
                  {contact.company_name}
                </p>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 p-1.5" aria-label="Close">
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3">
          {contact.connection_strength && (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--color-text-muted)]">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT[contact.connection_strength]}`}
              />
              {titleCase(contact.connection_strength)}
            </span>
          )}
          <div className="flex-1" />
          <a
            href={linkedInSearchUrl(personNameForSearch(contact.display_name, contact.email), contact.company_name)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-flex h-8 items-center gap-1.5 px-2.5 text-[12.5px]"
          >
            <IconLinkedin className="h-3.5 w-3.5" />
            {titleCase("LinkedIn")}
          </a>
          <button
            type="button"
            onClick={() =>
              onAddToDirectory({
                name: contact.display_name || contact.email,
                company: contact.company_name ?? "",
                email: contact.email,
              })
            }
            className="btn-ghost inline-flex h-8 items-center gap-1.5 px-2.5 text-[12.5px]"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {titleCase("Add to directory")}
          </button>
        </div>

        <div className="flex gap-1 border-b border-[var(--color-border)] px-5">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors ${
                activeTab === tab
                  ? "border-[var(--color-copper)] text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {titleCase(tab)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {active === undefined || active === "loading" ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("Loading…")}</p>
          ) : active === "error" ? (
            <p className="text-[13px] text-[var(--color-danger)]">{titleCase("Failed to load.")}</p>
          ) : active.length === 0 ? (
            <p className="text-[13px] italic text-[var(--color-text-muted)]">{titleCase("No activity yet.")}</p>
          ) : (
            <ul className="space-y-2.5">
              {active.map((item) => {
                const Icon = item.type === "meeting" ? CalendarIcon : Mail;
                const clickable = item.type === "email" && item.threadId;
                return (
                  <li key={`${item.type}-${item.id}`}>
                    <button
                      type="button"
                      disabled={!clickable}
                      onClick={() => item.threadId && setPreviewThreadId(item.threadId)}
                      className={`flex w-full items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition-colors ${
                        clickable ? "hover:bg-[var(--color-surface-offset)]" : "cursor-default"
                      }`}
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-offset)]">
                        <Icon className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-[var(--color-text)]">
                          <span className="truncate">{item.summary}</span>
                          {item.hasAttachments && (
                            <Paperclip className="h-3 w-3 shrink-0 text-[var(--color-text-faint)]" />
                          )}
                        </p>
                        {item.detail && (
                          <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">{item.detail}</p>
                        )}
                        <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">
                          {item.at ? new Date(item.at).toLocaleString() : ""}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {previewThreadId && (
        <EmailThreadPreviewModal threadId={previewThreadId} onClose={() => setPreviewThreadId(null)} />
      )}
    </div>,
    document.body
  );
}

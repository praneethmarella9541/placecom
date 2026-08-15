"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip } from "lucide-react";
import { GmailAvatar } from "@/components/GmailAvatar";
import { IconX } from "@/components/Icons";
import { CompanyLogo } from "@/components/CompanyLogo";
import { EmailThreadPreviewModal } from "@/components/EmailThreadPreviewModal";
import { CONNECTION_STRENGTH_DOT } from "@/lib/connection-strength-ui";
import type { EmailConnectionStrength } from "@/lib/email-connection-strength";
import { EMAIL_CATEGORY_COLORS } from "@/lib/email-category";
import { timeAgo } from "@/lib/utils";
import { titleCase } from "@/lib/title-case";
import type { SyncedCompanyRow } from "@/app/api/synced-contacts/companies/route";
import type { CompanyEmailItem } from "@/app/api/synced-contacts/companies/timeline/route";

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

type Tab = "Team" | "Emails";

function senderName(from: string): string {
  if (!from) return "Unknown";
  const match = from.match(/^"?([^"<]+)"?\s*</);
  if (match) return match[1].trim();
  const atIdx = from.indexOf("@");
  if (atIdx > 0) return from.slice(0, atIdx);
  return from;
}

/**
 * Company detail — Team (the roster of synced people at this domain, drill
 * into a person's own history via SyncedPersonModal) and Emails (every
 * thread to/from anyone @domain). Each email row shows a best-effort
 * category chip (see lib/email-category.ts — a keyword heuristic, not a
 * real classification engine) and opens in an in-app preview popup rather
 * than leaving to Gmail.
 */
export function SyncedCompanyModal({
  company,
  people,
  onClose,
  onOpenPerson,
}: {
  company: SyncedCompanyRow;
  people: SyncedContactRow[];
  onClose: () => void;
  onOpenPerson: (contact: SyncedContactRow) => void;
}) {
  const [tab, setTab] = useState<Tab>("Team");
  // undefined = not fetched yet (lazy on first switch to the Emails tab).
  const [emails, setEmails] = useState<CompanyEmailItem[] | "loading" | "error" | undefined>(undefined);
  const [previewThreadId, setPreviewThreadId] = useState<string | null>(null);

  const loadEmails = useCallback(async () => {
    setEmails("loading");
    try {
      const res = await fetch(
        `/api/synced-contacts/companies/timeline?${new URLSearchParams({ domain: company.domain }).toString()}`
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setEmails(json.items ?? []);
    } catch {
      setEmails("error");
    }
  }, [company.domain]);

  // Fetch lazily on first switch to the Emails tab, not on every toggle back to it.
  useEffect(() => {
    if (tab === "Emails" && emails === undefined) void loadEmails();
  }, [tab, emails, loadEmails]);

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
        className="card flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-offset)]">
              <CompanyLogo logoUrl={company.logoUrl} size={22} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-[var(--color-text)]">{company.companyName}</h3>
              <p className="truncate text-[13px] text-[var(--color-text-muted)]">{company.domain}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 p-1.5" aria-label="Close">
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-4 border-b border-[var(--color-border)] px-5 py-3 text-[12.5px] text-[var(--color-text-muted)]">
          <span>
            {company.contactCount} {titleCase(company.contactCount === 1 ? "contact" : "contacts")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT[company.bestConnectionStrength]}`} />
            {titleCase(company.bestConnectionStrength)}
          </span>
          <span>
            {company.lastInteractionAt
              ? titleCase(`Last contact ${timeAgo(company.lastInteractionAt)}`)
              : titleCase("No contact")}
          </span>
        </div>

        <div className="flex gap-1 border-b border-[var(--color-border)] px-5">
          {(["Team", "Emails"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold transition-colors ${
                tab === t
                  ? "border-[var(--color-copper)] text-[var(--color-text)]"
                  : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {titleCase(t)}
              {t === "Team" && ` · ${people.length}`}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {tab === "Team" ? (
            people.length === 0 ? (
              <p className="px-3 py-4 text-[13px] italic text-[var(--color-text-muted)]">
                {titleCase("No synced people at this company.")}
              </p>
            ) : (
              <ul className="space-y-1">
                {people.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onOpenPerson(p)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-offset)]"
                    >
                      <GmailAvatar seed={p.email} name={p.display_name || p.email} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[var(--color-text)]">
                          {p.display_name || p.email}
                        </p>
                        <p className="truncate text-[12px] text-[var(--color-text-muted)]">{p.email}</p>
                      </div>
                      {p.connection_strength && (
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT[p.connection_strength]}`}
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : emails === undefined || emails === "loading" ? (
            <p className="px-3 py-4 text-[13px] text-[var(--color-text-muted)]">{titleCase("Loading…")}</p>
          ) : emails === "error" ? (
            <p className="px-3 py-4 text-[13px] text-[var(--color-danger)]">
              {titleCase("Failed to load.")}{" "}
              <button type="button" className="underline" onClick={() => void loadEmails()}>
                {titleCase("Retry")}
              </button>
            </p>
          ) : emails.length === 0 ? (
            <p className="px-3 py-4 text-[13px] italic text-[var(--color-text-muted)]">
              {titleCase("No email activity with this company yet.")}
            </p>
          ) : (
            <ul className="space-y-1">
              {emails.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setPreviewThreadId(item.id)}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-offset)]"
                  >
                    <GmailAvatar seed={item.from} name={senderName(item.from)} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-[var(--color-text)]">
                        <span className="truncate">{item.subject}</span>
                        {item.hasAttachments && (
                          <Paperclip className="h-3 w-3 shrink-0 text-[var(--color-text-faint)]" />
                        )}
                      </p>
                      <p className="truncate text-[12px] text-[var(--color-text-muted)]">
                        {senderName(item.from)} · {item.snippet}
                      </p>
                      {item.category && (
                        <span
                          className="mt-1 inline-flex items-center rounded-full border px-1.5 py-[1px] text-[10px] font-medium leading-tight"
                          style={{
                            backgroundColor: EMAIL_CATEGORY_COLORS[item.category].bg,
                            color: EMAIL_CATEGORY_COLORS[item.category].fg,
                            borderColor: EMAIL_CATEGORY_COLORS[item.category].border,
                          }}
                        >
                          {item.category}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-[11px] text-[var(--color-text-faint)]">
                      {item.date ? timeAgo(item.date) : ""}
                    </span>
                  </button>
                </li>
              ))}
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

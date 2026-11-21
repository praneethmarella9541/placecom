"use client";

import { useCallback, useEffect, useState } from "react";
import { Lock, Paperclip, RefreshCw } from "lucide-react";
import { IconMail } from "@/components/Icons";
import { EmailThreadPreviewModal } from "@/components/EmailThreadPreviewModal";
import { useModuleVisibility } from "@/lib/module-visibility";
import { titleCase } from "@/lib/title-case";
import type { ContactMailItem } from "@/lib/contact-mail";

type Payload = {
  items: ContactMailItem[];
  hidden?: { common: boolean; others: boolean };
  fromCache: boolean;
  warnings: { mailboxType: "common" | "individual"; message: string }[];
};

const MAILBOX_LABEL: Record<ContactMailItem["mailboxType"], string> = {
  common: "Common mailbox",
  individual: "My mailbox",
};

/**
 * The Mail tab of a contact (BYOM). Mounted only once the tab is opened, so nothing is fetched
 * until the user asks for it. The server answers from its cache of thread headers and only goes
 * to Gmail for a mailbox with nothing recent (/api/synced-contacts/mail), and only ever returns
 * the user's own mailbox and the common one.
 */
export function ContactMailTab({ email, recordId }: { email?: string; recordId?: string }) {
  const mailEnabled = useModuleVisibility().isVisible("inbox");
  const [state, setState] = useState<Payload | "loading" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [open, setOpen] = useState<{ threadId: string; mailboxId: string } | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      if (refresh) setRefreshing(true);
      else setState("loading");
      setError(null);
      try {
        // A Data-tab record is looked up by its own addresses/domains; a contact by one address.
        const qs = new URLSearchParams(recordId ? {} : { email: email ?? "" });
        if (refresh) qs.set("refresh", "1");
        const base = recordId ? `/api/data/records/${recordId}/mail` : "/api/synced-contacts/mail";
        const res = await fetch(`${base}?${qs.toString()}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to load mail");
        setReason((json as { reason?: string }).reason ?? null);
        setState(json as Payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load mail");
        if (!refresh) setState("error");
      } finally {
        setRefreshing(false);
      }
    },
    [email, recordId]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (state === "loading") {
    return <p className="text-[13px] text-[var(--color-text-muted)]">{titleCase("Loading…")}</p>;
  }
  if (state === "error") {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-[var(--color-danger)]">{error ?? titleCase("Failed to load mail.")}</p>
        <button type="button" onClick={() => void load(false)} className="btn-ghost h-8 px-2.5 text-[12.5px]">
          {titleCase("Retry")}
        </button>
      </div>
    );
  }

  const showBadges = new Set(state.items.map((i) => i.mailboxType)).size > 1 || state.items.some((i) => i.mailboxType === "individual");

  return (
    <div className="space-y-3" data-testid="contact-mail-tab">
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="btn-ghost inline-flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-[12.5px] disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {titleCase("Refresh")}
        </button>
      </div>

      {error && <p className="text-[12.5px] text-[var(--color-danger)]">{error}</p>}
      {state.warnings.map((w) => (
        <p key={w.mailboxType} className="text-[12.5px] text-[var(--color-danger)]">
          {MAILBOX_LABEL[w.mailboxType]}: {w.message}
        </p>
      ))}

      <HiddenNotice hidden={state.hidden} />

      {state.items.length === 0 ? (
        // The notice above already explains an empty list when mail is hidden from this viewer.
        state.hidden?.common || state.hidden?.others ? null : (
        <p className="text-[13px] italic text-[var(--color-text-muted)]">
          {reason === "no_address"
            ? "Add an email address (or a domain, for a company) to see mail here."
            : "No mail with this contact in the mailboxes you can see."}
        </p>
        )
      ) : (
        <ul className="space-y-2.5">
          {state.items.map((item) => {
            const clickable = mailEnabled;
            return (
              <li
                key={`${item.mailboxId}-${item.threadId}`}
                onClick={clickable ? () => setOpen({ threadId: item.threadId, mailboxId: item.mailboxId }) : undefined}
                className={`flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${
                  clickable ? "cursor-pointer transition-colors hover:bg-[var(--color-surface-offset)]" : ""
                }`}
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-offset)]">
                  <IconMail className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-[var(--color-text)]">
                    <span className="truncate">{item.subject || "(no subject)"}</span>
                    {item.hasAttachments && <Paperclip className="h-3 w-3 shrink-0 text-[var(--color-text-faint)]" />}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-[var(--color-text-muted)]">
                    {item.from}
                    {item.messageCount > 1 ? ` · ${item.messageCount} messages` : ""}
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-[11px] text-[var(--color-text-faint)]">
                    <span>{item.at ? new Date(item.at).toLocaleString() : ""}</span>
                    {showBadges && (
                      <span className="rounded-full border border-[var(--color-border)] px-1.5 py-px">
                        {MAILBOX_LABEL[item.mailboxType]}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <EmailThreadPreviewModal threadId={open.threadId} mailboxId={open.mailboxId} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

/**
 * "There is more, but it isn't yours to read." Shown when the contact also corresponds with a
 * mailbox the viewer has no access to — so an empty or short list isn't taken for "no
 * correspondence". Says nothing about whose, or what.
 */
function HiddenNotice({ hidden }: { hidden: Payload["hidden"] }) {
  if (!hidden || (!hidden.common && !hidden.others)) return null;
  const message =
    hidden.common && hidden.others
      ? "Mail in the common mailbox and in other members' mailboxes isn't shown: you don't have access to it, or it's private to its owner."
      : hidden.common
        ? "Mail in the common mailbox isn't shown: you don't have access to it."
        : "Mail in another member's mailbox is private to its owner and isn't shown here.";
  return (
    <div
      data-testid="contact-mail-hidden"
      className="flex items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] bg-[var(--color-surface-offset)] px-3 py-2.5 text-[12.5px] text-[var(--color-text-muted)]"
    >
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}

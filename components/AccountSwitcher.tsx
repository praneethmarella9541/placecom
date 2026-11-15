"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Inbox, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMeMailbox } from "@/lib/use-me-mailbox";
import { hiddenFeatureSet } from "@/lib/module-visibility";
import { clearClientData } from "@/lib/clear-client-data";
import {
  MAILBOX_ACCESS_LABELS,
  mailboxAllows,
  type GrantedMailboxAccess,
  type MailboxAction,
  type MailboxOption,
} from "@/lib/mailbox-context-shared";

/**
 * BYOM account switcher: toggles between the user's own mailbox and the common one.
 *
 * Renders nothing unless there is something to show — two or more mailboxes, or limited
 * access to the one in use — so admins and existing staff see the same topbar as before.
 *
 * Switching reloads the page after clearing every client cache: mail lists, thread bodies,
 * the unread count and compose state all belong to one Gmail account, and a full reload is
 * the one way to be sure none of it carries into the other.
 */

function optionLabel(option: Pick<MailboxOption, "type">): string {
  return option.type === "common" ? "Common mailbox" : "My mailbox";
}

export function AccountSwitcher({ compact = false }: { compact?: boolean }) {
  const { me } = useMeMailbox();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = me?.mailboxes ?? [];
  const activeType = me?.activeMailboxType ?? "common";
  const activeAccess = me?.activeMailboxAccess ?? "full";
  if (!me || hiddenFeatureSet(me).has("byom")) return null;
  if (options.length < 2 && activeAccess === "full") return null;

  const isCommon = activeType === "common";

  async function switchTo(option: MailboxOption) {
    if (!option.id || option.id === me?.activeMailboxId) {
      setOpen(false);
      return;
    }
    setSwitching(option.id);
    setError(null);
    try {
      const res = await fetch("/api/me/mailbox-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailboxId: option.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Couldn't switch mailbox.");
      }
      clearClientData();
      window.location.assign("/inbox");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't switch mailbox.");
      setSwitching(null);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={me.mailboxEmail ?? undefined}
        className={cn(
          "flex h-9 items-center gap-2 rounded-lg border px-2.5 text-left transition-colors",
          compact ? "max-w-[170px]" : "max-w-[280px]",
          isCommon
            ? "border-[var(--color-copper)] bg-[var(--color-copper-tint)] hover:brightness-[0.98]"
            : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-offset)]",
        )}
      >
        {isCommon ? (
          <Users className="h-4 w-4 shrink-0 text-[var(--color-copper)]" strokeWidth={2} />
        ) : (
          <Inbox className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" strokeWidth={2} />
        )}
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-semibold leading-tight text-[var(--color-text)]">
            {optionLabel({ type: activeType })}
            {activeAccess !== "full" && (
              <span className="ml-1.5 font-medium text-[var(--color-text-muted)]">· {MAILBOX_ACCESS_LABELS[activeAccess]}</span>
            )}
          </span>
          {!compact && me.mailboxEmail && (
            <span className="block truncate text-[10px] leading-tight text-[var(--color-text-faint)]">{me.mailboxEmail}</span>
          )}
        </span>
        {options.length > 1 && (
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)] transition-transform", open && "rotate-180")}
          />
        )}
      </button>

      {open && options.length > 1 && (
        <div
          role="menu"
          className="animate-slide-down absolute right-0 top-full z-50 mt-1.5 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]"
        >
          <p className="border-b border-[var(--color-border)] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
            Switch mailbox
          </p>
          {options.map((option) => {
            const active = option.id === me.activeMailboxId;
            return (
              <button
                key={option.id ?? option.type}
                type="button"
                role="menuitem"
                disabled={switching !== null}
                onClick={() => void switchTo(option)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-offset)] disabled:opacity-60"
              >
                {option.type === "common" ? (
                  <Users className="h-4 w-4 shrink-0 text-[var(--color-copper)]" strokeWidth={2} />
                ) : (
                  <Inbox className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" strokeWidth={2} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-[var(--color-text)]">
                    {optionLabel(option)}
                    {option.access !== "full" && (
                      <span className="ml-1.5 text-[11px] text-[var(--color-text-muted)]">{MAILBOX_ACCESS_LABELS[option.access]}</span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--color-text-faint)]">{option.address ?? "—"}</span>
                </span>
                {switching === option.id ? (
                  <span className="text-[11px] text-[var(--color-text-faint)]">Switching…</span>
                ) : (
                  active && <Check className="h-4 w-4 shrink-0 text-[var(--color-copper)]" />
                )}
              </button>
            );
          })}
          {error && <p className="border-t border-[var(--color-border)] px-4 py-2 text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * BYOM: the user's access to the common mailbox, wherever they are working now — null when
 * they have none. Full when the module is off. Mirrors commonMailboxAccessForUser on the
 * server, which is what actually refuses the data.
 */
export function useCommonMailboxAccess(): {
  access: GrantedMailboxAccess | null;
  /**
   * May run or stop the contact sync of the mailbox they are in (lib/contact-sync-target.ts):
   * full access in the common mailbox, or any common access while in their own — which then
   * feeds the team's shared contact book.
   */
  canDriveContactSync: boolean;
} {
  const { me } = useMeMailbox();
  if (!me || hiddenFeatureSet(me).has("byom") || !me.mailboxes?.length) {
    return { access: "full", canDriveContactSync: true };
  }
  const access = me.mailboxes.find((m) => m.type === "common")?.access ?? null;
  return {
    access,
    canDriveContactSync:
      (me.activeMailboxType ?? "common") === "individual" ? access !== null : access === "full",
  };
}

/**
 * What the signed-in user may do in the mailbox they are working in. Hides buttons only —
 * the server refuses the action regardless (requireGmailAccessToken).
 */
export function useMailboxAccess(): { can: (action: MailboxAction) => boolean; isCommon: boolean } {
  const { me } = useMeMailbox();
  const access = me?.activeMailboxAccess ?? "full";
  return {
    can: (action) => mailboxAllows(access, action),
    isCommon: (me?.activeMailboxType ?? "common") === "common",
  };
}

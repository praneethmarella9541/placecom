"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { titleCase } from "@/lib/title-case";
import { MAILBOX_ACCESS_LABELS, type MailboxAccessLevel } from "@/lib/mailbox-context-shared";
import type { MailboxAccessMember, MailboxAccessResponse } from "@/app/api/admin/mailbox-access/route";
import type { CommonDomainStatus } from "@/lib/byom-signup-domains";

/**
 * Admin → Team → Mailbox access (BYOM). Who may work in the common mailbox and how, and which
 * email domains may sign up with their own mailbox.
 *
 * The default (no row) differs by member: someone with their own mailbox starts with no
 * access, everyone else keeps the full access staff have always had. "Default" in the select
 * puts a member back on that rule.
 */

const LEVELS: MailboxAccessLevel[] = ["none", "view", "reply", "full"];

const LEVEL_HELP: Record<MailboxAccessLevel, string> = {
  none: "Can't open the common mailbox.",
  view: "Read mail only — no replies, labels, or changes.",
  reply: "Read and reply in existing conversations. No new mail, mass sending, or changes.",
  full: "Everything, as before.",
};

type Props = {
  onToast?: (message: string, variant: "info" | "success" | "error") => void;
  /** After an access change, so the Members tab's badges catch up. */
  onChanged?: () => void | Promise<void>;
};

export function AdminMailboxAccessPanel({ onToast, onChanged }: Props) {
  const [data, setData] = useState<MailboxAccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [domainBusy, setDomainBusy] = useState(false);
  const notify = useCallback((m: string, v: "info" | "success" | "error") => onToast?.(m, v), [onToast]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/mailbox-access", { cache: "no-store" });
      const j = (await res.json()) as MailboxAccessResponse & { error?: string };
      if (!res.ok) throw new Error(j.error || "Could not load mailbox access");
      setData(j);
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not load mailbox access", "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setAccess(member: MailboxAccessMember, access: MailboxAccessLevel | null) {
    setSavingId(member.userId);
    try {
      const res = await fetch("/api/admin/mailbox-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.userId, access }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Could not save access");
      notify(`Access updated for ${member.displayName || member.email || "member"}.`, "success");
      await load();
      void onChanged?.();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save access", "error");
    } finally {
      setSavingId(null);
    }
  }

  async function changeDomain(method: "POST" | "DELETE", domain: string) {
    setDomainBusy(true);
    try {
      const res = await fetch("/api/admin/mailbox-access/domains", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Could not update domains");
      if (method === "POST") setDomainInput("");
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not update domains", "error");
    } finally {
      setDomainBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="card p-5">
        <p className="text-[13px] text-[var(--color-text-faint)]">{titleCase("Loading mailbox access…")}</p>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-5">
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--color-text)]">{titleCase("Common mailbox access")}</h3>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            What each member can do in <span className="font-medium text-[var(--color-text)]">{data.commonMailbox.address ?? "the common mailbox"}</span>.
            Members who connected their own mailbox start with no access here until you grant it.
          </p>
        </div>

        {data.members.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-faint)]">{titleCase("No team members yet.")}</p>
        ) : (
          <div className="divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
            {data.members.map((m) => (
              <div key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-[var(--color-text)]">{m.displayName || m.email || "—"}</p>
                  <p className="truncate text-[11px] text-[var(--color-text-faint)]">
                    {m.ownMailbox
                      ? `Own mailbox: ${m.ownMailbox.address ?? "—"}${m.ownMailbox.status === "disconnected" ? " (disconnected)" : ""}`
                      : "Common mailbox only"}
                  </p>
                </div>
                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <select
                    aria-label={`Common mailbox access for ${m.displayName || m.email || "member"}`}
                    value={m.explicit ? m.access : "default"}
                    disabled={savingId === m.userId}
                    title={LEVEL_HELP[m.access]}
                    onChange={(e) => {
                      const v = e.target.value;
                      void setAccess(m, v === "default" ? null : (v as MailboxAccessLevel));
                    }}
                    className="h-9 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 text-[13px] text-[var(--color-text)] sm:w-44"
                  >
                    <option value="default">
                      Default ({MAILBOX_ACCESS_LABELS[m.ownMailbox ? "none" : "full"]})
                    </option>
                    {LEVELS.map((l) => (
                      <option key={l} value={l}>
                        {MAILBOX_ACCESS_LABELS[l]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        <ul className="grid gap-1 text-[12px] text-[var(--color-text-faint)] sm:grid-cols-2">
          {LEVELS.map((l) => (
            <li key={l}>
              <span className="font-medium text-[var(--color-text-muted)]">{MAILBOX_ACCESS_LABELS[l]}:</span> {LEVEL_HELP[l]}
            </li>
          ))}
        </ul>
      </div>

      <div className="card space-y-3 p-5">
        <div>
          <h3 className="text-[14px] font-semibold text-[var(--color-text)]">{titleCase("Sign-up domains")}</h3>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            Anyone with an address on these domains can sign in with Google and join your team with their own mailbox,
            with no access to the common mailbox until you grant it. Other new accounts still need you to add them.
          </p>
        </div>
        {data.commonDomain && <CommonDomainNote {...data.commonDomain} />}
        <div className="flex flex-wrap gap-2">
          {data.signupDomains.length === 0 && (
            <p className="text-[13px] text-[var(--color-text-faint)]">{titleCase("No extra domains.")}</p>
          )}
          {data.signupDomains.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-offset)] py-1 pl-3 pr-1.5 text-[12px] font-medium text-[var(--color-text)]"
            >
              @{d}
              <button
                type="button"
                aria-label={`Remove ${d}`}
                disabled={domainBusy}
                onClick={() => {
                  if (confirm(`Stop new sign-ups from @${d}? People who already joined stay on the team.`)) {
                    void changeDomain("DELETE", d);
                  }
                }}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--color-text-faint)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (domainInput.trim()) void changeDomain("POST", domainInput);
          }}
        >
          <input
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="xlri.ac.in"
            aria-label="Domain to allow"
            className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-text)] sm:max-w-xs"
          />
          <button type="submit" disabled={domainBusy || !domainInput.trim()} className="btn-primary-copper inline-flex items-center gap-2 px-4">
            <Plus className="h-4 w-4" />
            {titleCase("Add domain")}
          </button>
        </form>
      </div>
    </div>
  );
}

/** How sign-ups on the common mailbox's own domain are handled. */
function CommonDomainNote({ domain, status }: { domain: string; status: CommonDomainStatus }) {
  const text: Record<CommonDomainStatus, string> = {
    automatic: `@${domain} is your common mailbox's domain, so sign-ups from it join your team automatically.`,
    claimed: `@${domain} is your common mailbox's domain and is in your list below.`,
    shared: `Other teams' common mailboxes also use @${domain}, so its sign-ups don't join anyone automatically. Add ${domain} below to send them to your team.`,
    taken: `@${domain} is your common mailbox's domain, but another team has added it, so its sign-ups go to them.`,
  };
  const warn = status === "shared" || status === "taken";
  return (
    <p
      className={`rounded-lg border px-3 py-2 text-[12.5px] ${
        warn
          ? "border-[var(--color-copper)] bg-[var(--color-copper-tint)] text-[var(--color-text)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-offset)] text-[var(--color-text-muted)]"
      }`}
    >
      {text[status]}
    </p>
  );
}

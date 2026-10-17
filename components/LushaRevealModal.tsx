"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { LushaMark } from "@/components/LushaLogo";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DirectoryContact } from "@/lib/contact-directory";
import type { FieldProposal } from "@/lib/integrations/enrichment";
import type { LushaPerson } from "@/lib/integrations/lusha";

type DryRun = {
  eligible: boolean;
  basis: "linkedin" | "email" | "name_company";
  reveal: ("emails" | "phones")[];
  estimatedCredits: number;
  estimates: { emails: number; phones: number; both: number };
  has: { email: boolean; phone: boolean };
  prior: {
    enrichmentId: string;
    revealedAt: string;
    applied: boolean;
    person: LushaPerson;
    proposals: FieldProposal[];
  } | null;
};

type Revealed = {
  enrichmentId: string | null;
  proposals: FieldProposal[];
  person?: LushaPerson;
  creditsCharged: number;
  message?: string;
  reused?: boolean;
};

const BASIS_TEXT: Record<DryRun["basis"], string> = {
  linkedin: "their LinkedIn link",
  email: "their email address",
  name_company: "their name and company",
};

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

type Props = {
  contact: DirectoryContact;
  onClose: () => void;
  /** Called after values were saved onto the contact, so the page can reload it. */
  onApplied: () => void;
};

/**
 * Find a contact's email and phone with the workspace's Lusha account.
 *
 * Nothing is spent until "Reveal" is pressed, and the cost shown is the most it can be. Lusha only
 * charges for what it finds, and a reveal is kept, so closing this without saving and coming back
 * offers the same result again at no cost.
 */
export function LushaRevealModal({ contact, onClose, onApplied }: Props) {
  const [phase, setPhase] = useState<"checking" | "ready" | "revealing" | "result" | "saving">("checking");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<DryRun | null>(null);
  const [wantEmail, setWantEmail] = useState(true);
  const [wantPhone, setWantPhone] = useState(true);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const choose = useCallback((proposals: FieldProposal[]) => {
    // Filling a blank is safe, so it starts ticked; overwriting something already there does not.
    setPicked(Object.fromEntries(proposals.map((p) => [p.field, p.mode === "fill" && !/do-not-call/.test(p.note ?? "")])));
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/integrations/lusha/reveal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId: contact.id, dryRun: true }),
        });
        const json = (await res.json().catch(() => ({}))) as Partial<DryRun> & { error?: string };
        if (!live) return;
        if (!res.ok) {
          setError(json.error || "Lusha can't look this contact up.");
          setPhase("ready");
          return;
        }
        const d = json as DryRun;
        setInfo(d);
        setWantEmail(!d.has.email);
        setWantPhone(!d.has.phone);
        setPhase("ready");
      } catch {
        if (live) {
          setError("Could not reach the server.");
          setPhase("ready");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [contact.id]);

  const reveal = useMemo<("emails" | "phones")[]>(
    () => [...(wantEmail ? (["emails"] as const) : []), ...(wantPhone ? (["phones"] as const) : [])],
    [wantEmail, wantPhone],
  );
  const estimate = !info
    ? 0
    : wantEmail && wantPhone
      ? info.estimates.both
      : wantEmail
        ? info.estimates.emails
        : wantPhone
          ? info.estimates.phones
          : 0;

  function showPrior() {
    if (!info?.prior) return;
    setRevealed({
      enrichmentId: info.prior.enrichmentId,
      proposals: info.prior.proposals,
      person: info.prior.person,
      creditsCharged: 0,
      reused: true,
    });
    choose(info.prior.proposals);
    setPhase("result");
  }

  async function doReveal() {
    if (reveal.length === 0 || phase === "revealing") return;
    setPhase("revealing");
    setError(null);
    try {
      const res = await fetch("/api/integrations/lusha/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: contact.id, reveal, force: true }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Revealed> & { error?: string; message?: string };
      if (!res.ok) {
        setError(json.error || "Lusha couldn't complete that.");
        setPhase("ready");
        return;
      }
      const r: Revealed = {
        enrichmentId: json.enrichmentId ?? null,
        proposals: json.proposals ?? [],
        person: json.person,
        creditsCharged: json.creditsCharged ?? 0,
        message: json.message,
        reused: json.reused,
      };
      setRevealed(r);
      choose(r.proposals);
      setPhase("result");
    } catch {
      setError("Could not reach the server.");
      setPhase("ready");
    }
  }

  async function save() {
    if (!revealed?.enrichmentId) return;
    const fields = revealed.proposals.filter((p) => picked[p.field]).map((p) => ({ field: p.field, value: p.proposed }));
    if (fields.length === 0) return;
    setPhase("saving");
    setError(null);
    try {
      const res = await fetch("/api/integrations/lusha/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrichmentId: revealed.enrichmentId, fields }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Could not save to the contact.");
        setPhase("result");
        return;
      }
      onApplied();
      onClose();
    } catch {
      setError("Could not reach the server.");
      setPhase("result");
    }
  }

  const anyPicked = revealed?.proposals.some((p) => picked[p.field]) ?? false;
  const person = revealed?.person;
  const otherEmails = person ? person.emails.filter((e) => !revealed?.proposals.some((p) => p.field === "email" && p.proposed.toLowerCase() === e.email)) : [];
  const otherPhones = person ? person.phones.filter((p) => !revealed?.proposals.some((q) => q.field === "phone" && q.proposed.replace(/\D/g, "") === p.number.replace(/\D/g, ""))) : [];

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Find with Lusha">
      <div className="surface-card flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden" data-testid="lusha-reveal-modal">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <LushaMark className="h-5 w-5" />
            <div>
              <h2 className="font-display text-[16px] font-bold text-[var(--color-text)]">Find with Lusha</h2>
              <p className="text-[12.5px] text-[var(--color-text-muted)]">{contact.name}{contact.company ? ` · ${contact.company}` : ""}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-[13px] text-[var(--color-text)]">
          {phase === "checking" ? (
            <p className="flex items-center gap-2 text-[var(--color-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Checking…</p>
          ) : null}

          {error ? <p className="rounded-lg bg-[var(--color-danger)]/5 px-3 py-2 text-[var(--color-danger)]">{error}</p> : null}

          {(phase === "ready" || phase === "revealing") && info ? (
            <>
              <p className="text-[var(--color-text-muted)]">
                We&apos;ll ask Lusha about {contact.name} using {BASIS_TEXT[info.basis]}. Lusha only charges for what it finds.
              </p>

              {info.prior ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
                  <p className="font-semibold text-[var(--color-text)]">Already revealed on {when(info.prior.revealedAt)}</p>
                  <p className="mt-0.5 text-[12.5px] text-[var(--color-text-muted)]">
                    You can use that result again at no cost{info.prior.applied ? " (it has been saved before)" : ""}.
                  </p>
                  <button type="button" onClick={showPrior} className="btn-primary mt-2 px-3 py-1.5 text-[12.5px] font-semibold">
                    Use the earlier result
                  </button>
                </div>
              ) : null}

              <fieldset className="space-y-2">
                <legend className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">What to find</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={wantEmail} onChange={(e) => setWantEmail(e.target.checked)} />
                  Email{info.has.email ? <span className="text-[var(--color-text-faint)]"> — this contact already has one</span> : null}
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={wantPhone} onChange={(e) => setWantPhone(e.target.checked)} />
                  Phone number{info.has.phone ? <span className="text-[var(--color-text-faint)]"> — this contact already has one</span> : null}
                </label>
              </fieldset>

              <p className="rounded-lg bg-[var(--color-surface-offset)] px-3 py-2 text-[12.5px] text-[var(--color-text-muted)]">
                {reveal.length === 0 ? "Choose at least one thing to find." : <>Up to <strong className="text-[var(--color-text)]">{estimate} credits</strong> from your Lusha account. The actual charge is shown afterwards.</>}
              </p>
            </>
          ) : null}

          {(phase === "result" || phase === "saving") && revealed ? (
            <>
              {revealed.message ? <p className="text-[var(--color-text-muted)]">{revealed.message}</p> : null}
              {revealed.proposals.length === 0 && !revealed.message ? (
                <p className="text-[var(--color-text-muted)]">Lusha found this person, but there is nothing new to add to the contact.</p>
              ) : null}

              {revealed.proposals.length > 0 ? (
                <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
                  {revealed.proposals.map((p) => (
                    <li key={p.field} className="flex items-start gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!!picked[p.field]}
                        onChange={(e) => setPicked((prev) => ({ ...prev, [p.field]: e.target.checked }))}
                        aria-label={`Save ${p.label}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{p.label}</p>
                        <p className="break-words font-medium text-[var(--color-text)]">{p.proposed}</p>
                        {p.mode === "replace" ? (
                          <p className="text-[12px] text-[var(--color-warning)]">Replaces {p.current}</p>
                        ) : null}
                        {p.note ? <p className="text-[12px] text-[var(--color-text-faint)]">{p.note}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}

              {otherEmails.length + otherPhones.length > 0 ? (
                <p className="text-[12px] text-[var(--color-text-faint)]">
                  Also found, not saved: {[...otherEmails.map((e) => e.email), ...otherPhones.map((p) => p.number)].join(", ")}
                </p>
              ) : null}

              <p className={cn("text-[12px]", revealed.reused ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--color-text-faint)]")}>
                {revealed.reused ? "No credits used — this is the earlier result." : `${revealed.creditsCharged} ${revealed.creditsCharged === 1 ? "credit" : "credits"} charged by Lusha.`}
              </p>
            </>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button type="button" onClick={onClose} className="btn-ghost px-3 py-2 text-[13px] font-semibold">
            {phase === "result" || phase === "saving" ? "Close" : "Cancel"}
          </button>
          {phase === "ready" || phase === "revealing" ? (
            <button
              type="button"
              onClick={() => void doReveal()}
              disabled={!info || reveal.length === 0 || phase === "revealing"}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
            >
              {phase === "revealing" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {phase === "revealing" ? "Asking Lusha…" : info?.prior ? "Look up again" : "Reveal"}
            </button>
          ) : null}
          {phase === "result" || phase === "saving" ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!anyPicked || phase === "saving" || !revealed?.enrichmentId}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
            >
              {phase === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save to contact
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

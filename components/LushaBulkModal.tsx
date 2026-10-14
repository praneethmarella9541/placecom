"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, X } from "lucide-react";

type Plan = {
  requested: number;
  toLookUp: number;
  reusedFree: number;
  skipped: number;
  skippedSample: { id: string; name: string; reason: string }[];
  estimatedCredits: number;
};

type Summary = {
  requested: number;
  found: number;
  notFound: number;
  updated: number;
  reusedFree: number;
  creditsCharged: number;
  skipped: { id: string; name: string; reason: string }[];
  notSaved: { id: string; name: string; reason: string }[];
  stopped: { code: string; message: string } | null;
};

type Props = {
  contactIds: string[];
  onClose: () => void;
  /** Called when a run finished, so the list can reload with the new emails and numbers. */
  onDone: () => void;
};

/** Group skip reasons so "Already has an email" appears once with a count, not once per contact. */
function reasonCounts(items: { reason: string }[]): [string, number][] {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.reason, (map.get(i.reason) ?? 0) + 1);
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

/**
 * Find emails and phone numbers for many contacts with the workspace's Lusha account.
 *
 * The plan is worked out first and spends nothing: how many will actually be looked up, how many
 * are skipped and why, and the most it could cost. A run only fills blanks — it never overwrites a
 * value already on a card.
 */
export function LushaBulkModal({ contactIds, onClose, onDone }: Props) {
  const [wantEmails, setWantEmails] = useState(true);
  const [wantPhones, setWantPhones] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const planSeq = useRef(0);

  const reveal = [...(wantEmails ? ["emails"] : []), ...(wantPhones ? ["phones"] : [])];

  useEffect(() => {
    if (reveal.length === 0) {
      setPlan(null);
      setPlanning(false);
      return;
    }
    const seq = ++planSeq.current;
    setPlanning(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/integrations/lusha/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactIds, reveal, dryRun: true }),
        });
        const json = (await res.json().catch(() => ({}))) as { plan?: Plan; error?: string };
        if (seq !== planSeq.current) return;
        if (!res.ok && !json.plan) setError(json.error || "Could not plan this run.");
        setPlan(json.plan ?? null);
      } catch {
        if (seq === planSeq.current) setError("Could not reach the server.");
      } finally {
        if (seq === planSeq.current) setPlanning(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantEmails, wantPhones, contactIds]);

  async function run() {
    if (running || !plan) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/lusha/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds, reveal }),
      });
      const json = (await res.json().catch(() => ({}))) as { summary?: Summary; error?: string };
      if (!res.ok || !json.summary) {
        setError(json.error || "Lusha couldn't complete that.");
        return;
      }
      setSummary(json.summary);
      onDone();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRunning(false);
    }
  }

  const nothingToDo = !!plan && plan.toLookUp + plan.reusedFree === 0;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Find with Lusha">
      <div className="surface-card flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden" data-testid="lusha-bulk-modal">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-[var(--color-copper)]" strokeWidth={2} />
            <div>
              <h2 className="font-display text-[16px] font-bold text-[var(--color-text)]">Find with Lusha</h2>
              <p className="text-[12.5px] text-[var(--color-text-muted)]">
                {contactIds.length} contact{contactIds.length === 1 ? "" : "s"} selected
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={running} aria-label="Close" className="rounded-lg p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-[13px] text-[var(--color-text)]">
          {error ? <p className="rounded-lg bg-[var(--color-danger)]/5 px-3 py-2 text-[var(--color-danger)]">{error}</p> : null}

          {summary ? (
            <div className="space-y-3">
              <p className="text-[14px] font-semibold">Done.</p>
              <ul className="space-y-1">
                <li><strong>{summary.updated}</strong> contact{summary.updated === 1 ? "" : "s"} updated with new details{summary.reusedFree > 0 ? ` (${summary.reusedFree} from earlier reveals, free)` : ""}</li>
                <li><strong>{summary.found}</strong> found by Lusha · <strong>{summary.notFound}</strong> with no match</li>
                <li>
                  <strong>{summary.creditsCharged}</strong> credit{summary.creditsCharged === 1 ? "" : "s"} charged by Lusha
                </li>
                {summary.skipped.length > 0 ? <li>{summary.skipped.length} skipped before looking up</li> : null}
              </ul>
              {summary.stopped ? (
                <p className="rounded-lg bg-[var(--color-warning-light)] px-3 py-2 text-[var(--color-warning)]">
                  The run stopped early: {summary.stopped.message} Contacts it reached were saved; select the rest and run again.
                </p>
              ) : null}
              {summary.notSaved.length > 0 ? (
                <div className="rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <p className="font-semibold">Found but not saved</p>
                  <ul className="mt-1 space-y-0.5 text-[12.5px] text-[var(--color-text-muted)]">
                    {summary.notSaved.slice(0, 8).map((n) => (
                      <li key={n.id}>{n.name}: {n.reason}</li>
                    ))}
                    {summary.notSaved.length > 8 ? <li>and {summary.notSaved.length - 8} more</li> : null}
                  </ul>
                </div>
              ) : null}
              <p className="text-[12px] text-[var(--color-text-faint)]">Only empty fields were filled. Nothing already on a contact was changed.</p>
            </div>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">What to find</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={wantEmails} disabled={running} onChange={(e) => setWantEmails(e.target.checked)} />
                  Email addresses
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={wantPhones} disabled={running} onChange={(e) => setWantPhones(e.target.checked)} />
                  Phone numbers <span className="text-[var(--color-text-faint)]">— these cost more credits</span>
                </label>
              </fieldset>

              {reveal.length === 0 ? (
                <p className="text-[var(--color-text-muted)]">Choose what to find.</p>
              ) : planning ? (
                <p className="flex items-center gap-2 text-[var(--color-text-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Working out the plan…</p>
              ) : plan ? (
                <div className="space-y-3">
                  <ul className="space-y-1">
                    <li><strong>{plan.toLookUp}</strong> will be looked up with Lusha</li>
                    {plan.reusedFree > 0 ? <li><strong>{plan.reusedFree}</strong> filled from earlier reveals, at no cost</li> : null}
                    {plan.skipped > 0 ? (
                      <li>
                        <strong>{plan.skipped}</strong> skipped:{" "}
                        <span className="text-[var(--color-text-muted)]">
                          {reasonCounts(plan.skippedSample).map(([r, n]) => `${n} · ${r.replace(/\.$/, "")}`).join("; ")}
                          {plan.skipped > plan.skippedSample.length ? "; …" : ""}
                        </span>
                      </li>
                    ) : null}
                  </ul>
                  {nothingToDo ? (
                    <p className="text-[var(--color-text-muted)]">There is nothing to look up for this selection.</p>
                  ) : (
                    <p className="rounded-lg bg-[var(--color-surface-offset)] px-3 py-2 text-[12.5px] text-[var(--color-text-muted)]">
                      Up to <strong className="text-[var(--color-text)]">{plan.estimatedCredits} credits</strong> from your Lusha account. Lusha only charges for what it finds, and the actual charge is shown afterwards. Only empty fields are filled; nothing already on a contact is overwritten.
                    </p>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button type="button" onClick={onClose} disabled={running} className="btn-ghost px-3 py-2 text-[13px] font-semibold disabled:opacity-50">
            {summary ? "Close" : "Cancel"}
          </button>
          {!summary ? (
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || planning || !plan || nothingToDo || reveal.length === 0}
              className="btn-primary inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {running ? "Asking Lusha…" : plan && plan.estimatedCredits > 0 ? `Find (up to ${plan.estimatedCredits} credits)` : "Find"}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

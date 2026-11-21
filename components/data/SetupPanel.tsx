"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { dataApi } from "@/lib/data-model/client";

type Counts = Record<string, number | boolean>;

type Step = {
  id: "backfill" | "backfill_leads";
  title: string;
  intro: string;
  confirmTitle: string;
  confirmBody: string;
  rows: [string, string][];
};

const STEPS: Step[] = [
  {
    id: "backfill",
    title: "Contacts",
    intro: "Copy your existing contacts in as people and companies.",
    confirmTitle: "Copy contacts into the data model?",
    confirmBody: "This adds the people and companies from the preview. Your Contacts and CRM are not changed. Running it again only adds what is new.",
    rows: [
      ["people_from_synced_contacts", "People from the mailbox contacts"],
      ["people_from_directory_contacts", "People from the team directory"],
      ["directory_cards_merged_into_existing_people", "Directory cards merged into a person already found"],
      ["directory_cards_skipped_no_name_or_email", "Directory cards skipped (no name or email)"],
      ["companies_created", "Companies created from email domains"],
      ["people_linked_to_company", "People linked to their company"],
    ],
  },
  {
    id: "backfill_leads",
    title: "CRM leads and notes",
    intro: "Copy the CRM pipeline into a Leads list, with its stages merged into one shared set, and bring the interactions across as notes. Do the contacts step first.",
    confirmTitle: "Copy the CRM pipeline into a Leads list?",
    confirmBody: "This adds a Leads list, shared stages, the leads as entries, and their interactions as notes. Your CRM board is not changed or removed. Running it again only adds what is new.",
    rows: [
      ["stages_created", "Stages created (merged by name across boards)"],
      ["leads_added_to_list", "Leads added to the Leads list"],
      ["leads_skipped_same_person_already_on_list", "Leads skipped (same person already on the list)"],
      ["leads_matched_to_existing_people", "Leads matched to a person already found"],
      ["people_created_from_leads", "People created from leads"],
      ["companies_created", "Companies created from lead company names"],
      ["interactions_copied_as_notes", "Lead interactions copied as notes"],
      ["contact_notes_copied", "Contact book notes copied"],
    ],
  },
];

/** Admin: create the model, then preview and copy the old data in, step by step. */
export function SetupPanel({ hasObjects, onDone, onChanged }: { hasObjects: boolean; onDone: () => void; /** Called after each copy, so a dialog can stay open for the next step. */ onChanged?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Counts>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState<Step | null>(null);

  async function run(kind: "seed" | Step["id"], dryRun = true) {
    setBusy(`${kind}:${dryRun ? "preview" : "copy"}`);
    setError(null);
    const r = await dataApi<{ result?: Counts }>("/api/data/setup", {
      method: "POST",
      body: kind === "seed" ? { action: "seed" } : { action: kind, dryRun },
    });
    setBusy(null);
    setConfirm(null);
    if (!r.ok) return setError(r.error);
    if (kind === "seed") return onDone();
    if (dryRun) return setPreviews((p) => ({ ...p, [kind]: r.data.result ?? {} }));
    setDone((d) => ({ ...d, [kind]: true }));
    if (onChanged) onChanged();
    else onDone();
  }

  return (
    <div className="card mx-auto max-w-[680px] space-y-5 p-6">
      <div>
        <h2 className="font-display text-lg font-bold">Set up your data</h2>
        <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
          Contacts and the CRM keep working exactly as they do now; nothing in them is changed or removed. Preview each copy first: it shows the numbers and saves nothing.
        </p>
      </div>

      {!hasObjects ? (
        <button type="button" disabled={busy !== null} onClick={() => void run("seed")} className="btn-primary-copper inline-flex items-center gap-2">
          {busy === "seed:preview" && <Loader2 className="h-4 w-4 animate-spin" />}
          Create People, Companies and Deals
        </button>
      ) : (
        STEPS.map((step) => {
          const preview = previews[step.id];
          return (
            <section key={step.id} className="space-y-3 border-t border-[var(--color-border)] pt-4" aria-label={step.title}>
              <div>
                <h3 className="text-[13px] font-semibold">{step.title}</h3>
                <p className="text-[12.5px] text-[var(--color-text-muted)]">{step.intro}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy !== null} onClick={() => void run(step.id, true)} className="btn-ghost inline-flex items-center gap-2">
                  {busy === `${step.id}:preview` && <Loader2 className="h-4 w-4 animate-spin" />}
                  Preview
                </button>
                <button type="button" disabled={!preview || busy !== null} onClick={() => setConfirm(step)} className="btn-primary-copper">
                  Copy in
                </button>
                {done[step.id] && <span role="status" className="text-[12.5px] font-semibold text-[var(--color-success)]">Copied</span>}
              </div>
              {preview && (
                <dl className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] text-[13px]">
                  {step.rows.map(([key, label]) => (
                    <div key={key} className="flex justify-between gap-4 px-3 py-2">
                      <dt className="text-[var(--color-text-muted)]">{label}</dt>
                      <dd className="font-semibold tabular-nums">{Number(preview[key] ?? 0).toLocaleString("en-IN")}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          );
        })
      )}

      {hasObjects && (
        <button type="button" onClick={onDone} className="text-[12.5px] font-semibold text-[var(--color-text-muted)] underline">
          Close
        </button>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
          {error}
        </p>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.confirmTitle}
          body={confirm.confirmBody}
          confirmLabel="Copy"
          busy={busy === `${confirm.id}:copy`}
          onConfirm={() => void run(confirm.id, false)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

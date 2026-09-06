"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Loader2, Mail, MoreVertical, Settings2, Trash2, Users } from "lucide-react";
import { SequenceStatusPill } from "@/components/SequenceStatusPill";
import { SequenceStepList } from "@/components/SequenceStepList";
import { SequenceRecipientsTab } from "@/components/SequenceRecipientsTab";
import { SequenceSettingsTab } from "@/components/SequenceSettingsTab";
import { buildStepEmail } from "@/lib/sequence-body";
import { titleCase } from "@/lib/title-case";
import type {
  EnrollmentCounts,
  Sequence,
  SequenceStep,
  SequenceStepInput,
} from "@/lib/sequence-types";
import { emptyEnrollmentCounts } from "@/lib/sequence-types";

type Tab = "editor" | "recipients" | "settings";
const TABS: Tab[] = ["editor", "recipients", "settings"];

type Preview = { subject: string; html: string; missing: string[]; previewFor: string };
type PreviewRecipient = {
  id: string;
  email: string;
  displayName: string | null;
  mergeFields: Record<string, string>;
};

export function SequenceEditor({ sequenceId }: { sequenceId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [steps, setSteps] = useState<SequenceStepInput[]>([]);
  const [savedSteps, setSavedSteps] = useState<string>("[]");
  const [counts, setCounts] = useState<EnrollmentCounts>(emptyEnrollmentCounts());
  const [tab, setTab] = useState<Tab>("editor");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Inline, in-place preview (mirrors mass sending's "review" pane rather than
  // a popup) — the step being previewed swaps its editable fields for the
  // rendered result in place, with a recipient picker to see it merged for
  // someone specific. Rendered client-side from the *current, possibly
  // unsaved* editor state (not re-fetched from the saved step), so what you
  // see always matches what's in the box — no stale content from before your
  // last edit, and no need to save first just to look at it.
  const [previewingIndex, setPreviewingIndex] = useState<number | null>(null);
  const [previewEnrollmentId, setPreviewEnrollmentId] = useState<string | null>(null);
  const [previewRecipients, setPreviewRecipients] = useState<PreviewRecipient[]>([]);
  const [previewRecipientsLoading, setPreviewRecipientsLoading] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  useEffect(() => {
    const requested = searchParams.get("tab");
    if (requested && (TABS as string[]).includes(requested)) setTab(requested as Tab);
  }, [searchParams]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequenceId)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        error?: string;
        sequence?: Sequence;
        steps?: SequenceStep[];
        counts?: EnrollmentCounts;
      };
      if (!res.ok) throw new Error(data.error || "Failed to load sequence");
      if (data.sequence) setSequence(data.sequence);
      const incoming: SequenceStepInput[] = (data.steps ?? []).map((s) => ({
        id: s.id,
        kind: s.kind,
        subjectTemplate: s.subjectTemplate ?? "",
        bodyHtml: s.bodyHtml ?? "",
        delayDays: s.delayDays,
        delayHours: s.delayHours,
      }));
      setSteps(incoming);
      setSavedSteps(JSON.stringify(incoming));
      setCounts(data.counts ?? emptyEnrollmentCounts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sequence");
    } finally {
      setLoading(false);
    }
  }, [sequenceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stepsDirty = useMemo(() => JSON.stringify(steps) !== savedSteps, [steps, savedSteps]);

  async function saveSteps() {
    if (saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequenceId)}/steps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps }),
      });
      const data = (await res.json()) as {
        error?: string;
        steps?: SequenceStep[];
        repaired?: number;
      };
      if (!res.ok) throw new Error(data.error || "Could not save steps");

      const saved: SequenceStepInput[] = (data.steps ?? []).map((s) => ({
        id: s.id,
        kind: s.kind,
        subjectTemplate: s.subjectTemplate ?? "",
        bodyHtml: s.bodyHtml ?? "",
        delayDays: s.delayDays,
        delayHours: s.delayHours,
      }));
      setSteps(saved);
      setSavedSteps(JSON.stringify(saved));
      setNotice(
        data.repaired
          ? `Saved. ${data.repaired} in-flight recipient${data.repaired === 1 ? "" : "s"} rescheduled.`
          : "Saved.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save steps");
    } finally {
      setSaving(false);
    }
  }

  async function patchSequence(patch: Partial<Sequence>) {
    if (!sequence) return;
    const optimistic = { ...sequence, ...patch };
    setSequence(optimistic);
    setError(null);
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequenceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as { error?: string; sequence?: Sequence };
      if (!res.ok) throw new Error(data.error || "Could not save settings");
      if (data.sequence) setSequence(data.sequence);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save settings");
      await load(); // roll back to server truth
    }
  }

  async function togglePublish(action: "publish" | "pause") {
    if (publishing) return;
    setPublishing(true);
    setError(null);
    setNotice(null);
    try {
      // Unsaved step edits would not be part of what gets published.
      if (stepsDirty) await saveSteps();
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequenceId)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as {
        error?: string;
        sequence?: Sequence;
        scheduled?: number;
      };
      if (!res.ok) throw new Error(data.error || "Could not update sequence");
      if (data.sequence) setSequence(data.sequence);
      setNotice(
        action === "publish"
          ? `Sequence enabled.${data.scheduled ? ` ${data.scheduled} recipient(s) scheduled.` : ""}`
          : "Sequence paused.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update sequence");
    } finally {
      setPublishing(false);
    }
  }

  async function handleDelete() {
    if (deleting || !sequence) return;
    // DELETE always hard-deletes now (app/api/sequences/[sequenceId]/route.ts) —
    // for anything past draft that also drops the recipient list and send log,
    // so spell that out.
    const question =
      sequence.status === "draft"
        ? `Delete "${sequence.name}"? This can't be undone.`
        : `Delete "${sequence.name}"? This permanently removes the sequence, its recipients, and its send history. Mail already sent is not recalled. This can't be undone.`;
    if (!window.confirm(question)) return;

    setMenuOpen(false);
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequenceId)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string; deleted?: boolean };
      if (!res.ok) throw new Error(data.error || "Could not delete sequence");
      router.push("/sequences");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete sequence");
      setDeleting(false);
    }
  }

  function openPreview(index: number) {
    if (previewingIndex === index) {
      setPreviewingIndex(null);
      return;
    }
    setPreviewingIndex(index);
    setPreviewEnrollmentId(null);

    if (previewRecipients.length === 0 && !previewRecipientsLoading) {
      setPreviewRecipientsLoading(true);
      void fetch(`/api/sequences/${encodeURIComponent(sequenceId)}/enrollments`)
        .then((res) => res.json())
        .then(
          (data: {
            enrollments?: {
              id: string;
              email: string;
              displayName: string | null;
              mergeFields?: Record<string, string>;
            }[];
          }) => {
            setPreviewRecipients(
              (data.enrollments ?? []).map((e) => ({
                id: e.id,
                email: e.email,
                displayName: e.displayName,
                mergeFields: e.mergeFields ?? {},
              }))
            );
          }
        )
        .catch(() => {})
        .finally(() => setPreviewRecipientsLoading(false));
    }
  }

  function selectPreviewRecipient(enrollmentId: string) {
    setPreviewEnrollmentId(enrollmentId);
  }

  // Sample data stands in until a recipient is enrolled, or none is picked —
  // matches what the standalone preview API used to default to.
  const previewData = useMemo<Preview | null>(() => {
    if (previewingIndex === null) return null;
    const step = steps[previewingIndex];
    if (!step || step.kind !== "email" || !sequence) return null;

    const chosen = previewEnrollmentId
      ? previewRecipients.find((r) => r.id === previewEnrollmentId)
      : previewRecipients[0];

    const recipient = chosen
      ? { email: chosen.email, displayName: chosen.displayName, mergeFields: chosen.mergeFields }
      : { email: "recipient@example.com", displayName: "Sample Recipient", mergeFields: {} };

    const built = buildStepEmail(
      {
        subjectTemplate: step.subjectTemplate ?? "",
        bodyHtml: step.bodyHtml ?? "",
        includeSignature: sequence.includeSignature,
        signatureHtml: sequence.signatureHtml,
      },
      recipient
    );

    return { subject: built.subject, html: built.html, missing: built.missing, previewFor: recipient.email };
  }, [previewingIndex, previewEnrollmentId, previewRecipients, steps, sequence]);

  if (loading) {
    return (
      <div className="py-12 text-center text-[13px] text-[var(--color-text-faint)]">
        {titleCase("Loading sequence…")}
      </div>
    );
  }

  if (!sequence) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Link
          href="/sequences"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-copper)]"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
          {titleCase("All sequences")}
        </Link>
        <p className="text-[13px] text-[var(--color-danger)]">
          {error || titleCase("Sequence not found.")}
        </p>
      </div>
    );
  }

  const isActive = sequence.status === "active";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href="/sequences"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-copper)]"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
        {titleCase("All sequences")}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* Plain <input> has no intrinsic width tied to its value — with no
              `size`/CSS width set it falls back to the browser's ~20-character
              default, so an 8-letter name like "Outreach" still rendered a
              wide box, and the hover/focus background filled that whole box
              rather than hugging the text. `ch` units track the actual value
              length, +1.5 for the caret and a little breathing room. */}
          <input
            data-testid="sequence-name-input"
            value={sequence.name}
            onChange={(e) => setSequence({ ...sequence, name: e.target.value })}
            onBlur={(e) => void patchSequence({ name: e.target.value })}
            style={{ width: `${Math.max(sequence.name.length, 4) + 1.5}ch` }}
            className="min-w-0 max-w-full truncate rounded-lg border border-transparent bg-transparent px-1 font-display text-[19px] font-bold tracking-tight text-[var(--color-text)] outline-none hover:bg-[var(--color-surface-2)] focus:border-[var(--color-copper)] focus:bg-[var(--color-surface)]"
          />
          <SequenceStatusPill status={sequence.status} />
        </div>
        <div className="flex items-center gap-2">
          {stepsDirty ? (
            <button
              data-testid="sequence-save-btn"
              type="button"
              onClick={() => void saveSteps()}
              disabled={saving}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 text-[14px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-offset)] disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {titleCase(saving ? "Saving…" : "Save changes")}
            </button>
          ) : null}
          <button
            data-testid="sequence-publish-btn"
            type="button"
            onClick={() => void togglePublish(isActive ? "pause" : "publish")}
            disabled={publishing}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[var(--color-copper)] px-5 text-[14px] font-semibold text-white transition hover:bg-[var(--color-copper-hover)] disabled:opacity-60"
          >
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {titleCase(isActive ? "Pause sequence" : "Enable sequence")}
          </button>
          <div ref={menuRef} className="relative">
            <button
              data-testid="sequence-more-btn"
              type="button"
              aria-label={titleCase("More options")}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
            >
              <MoreVertical className="h-4 w-4" strokeWidth={2} />
            </button>
            {menuOpen ? (
              <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]">
                <button
                  data-testid="sequence-delete-btn"
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[13px] font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-surface-offset)] disabled:opacity-60"
                >
                  {deleting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                  {titleCase(deleting ? "Deleting…" : "Delete sequence")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-4 py-3 text-[13px] text-[var(--color-danger)]">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3 text-[13px] text-[var(--color-text-muted)]">
          {notice}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
        {(
          [
            { id: "editor" as const, label: "Editor", icon: Mail },
            { id: "recipients" as const, label: "Recipients", icon: Users },
            { id: "settings" as const, label: "Settings", icon: Settings2 },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            data-testid={`sequence-editor-tab-${id}`}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === id
                ? "border-b-2 border-[var(--color-copper)] text-[var(--color-copper)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {titleCase(label)}
            {id === "recipients" && counts.active > 0 ? (
              <span className="font-mono text-[11px] text-[var(--color-text-faint)]">
                {counts.active}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "editor" ? (
        <SequenceStepList
          steps={steps}
          businessDaysOnly={sequence.businessDaysOnly}
          threadEmails={sequence.threadEmails}
          disabled={saving}
          onChange={setSteps}
          onPreview={openPreview}
          previewingIndex={previewingIndex}
          previewData={previewData}
          previewRecipients={previewRecipients}
          previewEnrollmentId={previewEnrollmentId}
          onSelectPreviewRecipient={selectPreviewRecipient}
        />
      ) : null}

      {tab === "recipients" ? (
        <SequenceRecipientsTab sequence={sequence} onCountsChanged={() => void load()} />
      ) : null}

      {tab === "settings" ? (
        <SequenceSettingsTab
          sequence={sequence}
          saving={saving}
          onChange={(patch) => void patchSequence(patch)}
        />
      ) : null}

    </div>
  );
}

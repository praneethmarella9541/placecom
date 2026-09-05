"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, Loader2, Mail, Settings2, Users, X } from "lucide-react";
import { SequenceStatusPill } from "@/components/SequenceStatusPill";
import { SequenceStepList } from "@/components/SequenceStepList";
import { SequenceRecipientsTab } from "@/components/SequenceRecipientsTab";
import { SequenceSettingsTab } from "@/components/SequenceSettingsTab";
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

export function SequenceEditor({ sequenceId }: { sequenceId: string }) {
  const searchParams = useSearchParams();

  const [sequence, setSequence] = useState<Sequence | null>(null);
  const [steps, setSteps] = useState<SequenceStepInput[]>([]);
  const [savedSteps, setSavedSteps] = useState<string>("[]");
  const [counts, setCounts] = useState<EnrollmentCounts>(emptyEnrollmentCounts());
  const [tab, setTab] = useState<Tab>("editor");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

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

  async function openPreview(index: number) {
    const step = steps[index];
    if (!step?.id) {
      setError("Save the sequence before previewing this step.");
      return;
    }
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequenceId)}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: step.id }),
      });
      const data = (await res.json()) as Preview & { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not build preview");
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build preview");
    }
  }

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
          <input
            data-testid="sequence-name-input"
            value={sequence.name}
            onChange={(e) => setSequence({ ...sequence, name: e.target.value })}
            onBlur={(e) => void patchSequence({ name: e.target.value })}
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
          onPreview={(index) => void openPreview(index)}
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

      {preview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-[14.5px] font-semibold text-[var(--color-text)]">
                  {preview.subject || titleCase("(no subject)")}
                </p>
                <p className="font-mono mt-0.5 truncate text-[11.5px] text-[var(--color-text-faint)]">
                  {titleCase("To")} {preview.previewFor}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                aria-label="Close preview"
                className="rounded-lg p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            {preview.missing.length > 0 ? (
              <p className="border-b border-[var(--color-border)] bg-amber-500/5 px-5 py-3 text-[12.5px] text-amber-700 dark:text-amber-400">
                {titleCase("These recipients will be skipped until these fields have values")}:{" "}
                {preview.missing.join(", ")}
              </p>
            ) : null}
            <div
              className="prose-sm max-w-none overflow-y-auto px-5 py-4 text-[14px] text-[var(--color-text)]"
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

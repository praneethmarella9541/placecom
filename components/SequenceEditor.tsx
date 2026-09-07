"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, Loader2, Mail, Save, Settings2, Trash2, Users } from "lucide-react";
import { SequenceStatusPill } from "@/components/SequenceStatusPill";
import { SequenceStepList } from "@/components/SequenceStepList";
import { SequenceRecipientsTab } from "@/components/SequenceRecipientsTab";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { SequenceSettingsTab } from "@/components/SequenceSettingsTab";
import { buildMergeFields, buildStepEmail } from "@/lib/sequence-body";
import { validateMergeTemplates } from "@/lib/mail-merge";
import { mergeFieldCoverage, variablesForEnrollments } from "@/lib/sequence-variables";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";
import type {
  EnrollmentCounts,
  Sequence,
  SequenceEnrollment,
  SequenceStep,
  SequenceStepAttachment,
  SequenceStepInput,
} from "@/lib/sequence-types";
import { emptyEnrollmentCounts } from "@/lib/sequence-types";

type Tab = "editor" | "recipients" | "settings";
const TABS: Tab[] = ["editor", "recipients", "settings"];

type Preview = {
  subject: string;
  html: string;
  /** Still unfilled after fallbacks — these are what actually skip the send. */
  missing: string[];
  /** Unfilled by the recipient's own data, fallback or not. Drives the chips,
   *  which have to stay on screen after a fallback is typed into them. */
  missingKeys: string[];
  previewFor: string;
};
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
  /**
   * The one copy of the recipient list. Both the step editor (variable
   * coverage, preview rail) and the Recipients tab read it, so it is fetched
   * here rather than in each — they were independently hitting the same
   * endpoint on load, and that endpoint now resolves contact data, so the
   * second call was doing the whole lookup again for nothing.
   */
  const [enrollments, setEnrollments] = useState<SequenceEnrollment[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  // Kept beside the steps rather than inside them: `steps` is diffed against
  // its last saved copy to drive the "Save changes" button, and attaching a
  // file must not make the step text look edited.
  const [attachmentsByStep, setAttachmentsByStep] = useState<
    Record<string, SequenceStepAttachment[]>
  >({});
  /**
   * Where the user asked to go while step edits were unsaved. Non-null means
   * the guard dialog is up; it doubles as the destination so the same dialog
   * serves any exit, not just the back link.
   */
  const [pendingLeaveTo, setPendingLeaveTo] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
        delayMinutes: s.delayMinutes,
      }));
      setSteps(incoming);
      setSavedSteps(JSON.stringify(incoming));
      setAttachmentsByStep(
        Object.fromEntries(
          (data.steps ?? []).map((s) => [s.id, s.attachments ?? []]),
        ),
      );
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

  // Loaded with the sequence rather than on first preview: the merge fields
  // these carry are what the editor tab offers as variables, so they have to
  // be in hand before a step is written, not after someone opens the preview.
  const loadRecipients = useCallback(async () => {
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequenceId)}/enrollments`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { error?: string; enrollments?: SequenceEnrollment[] };
      if (!res.ok) throw new Error(data.error || "Failed to load recipients");
      setEnrollments(data.enrollments ?? []);
    } catch (e) {
      // Non-fatal for the step editor — it falls back to the standard variable
      // list with no coverage counts — but the Recipients tab needs to say so.
      setError(e instanceof Error ? e.message : "Failed to load recipients");
    } finally {
      setRecipientsLoading(false);
    }
  }, [sequenceId]);

  useEffect(() => {
    void loadRecipients();
  }, [loadRecipients]);

  const stepsDirty = useMemo(() => JSON.stringify(steps) !== savedSteps, [steps, savedSteps]);
  /**
   * Guards every in-app exit, not just the back link — the sidebar, the header
   * logo, anything rendering an <a>.
   *
   * Done as a capture-phase listener on the document rather than by threading
   * a callback through the layout: the App Router has no navigation-blocking
   * API (no router.events), and the sidebar calls router.push() from its own
   * onClick, so the only place to stop it is before the event reaches it.
   * Scoped to a dirty editor, so nothing is intercepted the rest of the time.
   */
  useEffect(() => {
    if (!stepsDirty) return;

    /** The in-app path this event would navigate to, or null to let it through. */
    function destinationFor(e: Event): string | null {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      if (!anchor) return null;
      if (anchor.hasAttribute("download")) return null;
      if (anchor.target && anchor.target !== "_self") return null;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return null;
      }
      // Leaves mailto:, tel: and outbound links in previewed email bodies alone.
      if (url.origin !== window.location.origin) return null;
      // Same page or a bare hash — no work is at risk.
      if (url.pathname === window.location.pathname) return null;
      return `${url.pathname}${url.search}`;
    }

    // The sidebar starts its loading indicator on pointerdown, before the click
    // it is anticipating. Stop it there or it spins for a navigation that the
    // click handler below is about to block.
    function onPointerDownCapture(e: PointerEvent) {
      if (e.button !== 0) return;
      if (destinationFor(e)) e.stopPropagation();
    }

    function onClickCapture(e: MouseEvent) {
      // Ctrl/cmd/shift-click opens a new tab and leaves this one alone.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const destination = destinationFor(e);
      if (!destination) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingLeaveTo(destination);
    }

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    document.addEventListener("click", onClickCapture, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
      document.removeEventListener("click", onClickCapture, true);
    };
  }, [stepsDirty]);

  // Covers the exits React cannot intercept — tab close, reload, typing a new
  // URL. The browser shows its own generic wording here; the in-app dialog is
  // what handles the case we can actually phrase ourselves.
  useEffect(() => {
    if (!stepsDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [stepsDirty]);

  const previewRecipients = useMemo<PreviewRecipient[]>(
    () =>
      enrollments.map((e) => ({
        id: e.id,
        email: e.email,
        displayName: e.displayName,
        mergeFields: e.mergeFields ?? {},
      })),
    [enrollments],
  );

  // What the enrolled recipients can actually fill. Variables come from their
  // stored fields (so an API-set key is offered like any other), and the counts
  // say how many of them have each one — a step using a variable nobody has
  // would skip every recipient at send time.
  const recipientFieldSets = useMemo(
    () => previewRecipients.map((r) => r.mergeFields),
    [previewRecipients],
  );
  const variableCoverage = useMemo(
    () => mergeFieldCoverage(recipientFieldSets, variablesForEnrollments(recipientFieldSets)),
    [recipientFieldSets],
  );
  // Coverage rides in the hint rather than in a list under the editor: the `{`
  // picker is where a variable is chosen, so that's where "12 of 15 recipients
  // have this" is worth reading.
  const stepVariables = useMemo(() => {
    const base = variablesForEnrollments(recipientFieldSets);
    if (recipientFieldSets.length === 0) return base;
    return base.map((v) => ({
      ...v,
      hint: `${v.hint} · ${variableCoverage[v.key] ?? 0} of ${recipientFieldSets.length} recipients`,
    }));
  }, [recipientFieldSets, variableCoverage]);

  async function saveSteps(): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      // A delay wound down to 0d 0h is the user saying "no delay here", not a
      // step they want kept — the API rejects a zero-length wait, so it is
      // dropped rather than bounced back as an error.
      const payload = steps.filter(
        (s) =>
          s.kind !== "wait" ||
          (s.delayDays ?? 0) + (s.delayHours ?? 0) + (s.delayMinutes ?? 0) > 0,
      );
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequenceId)}/steps`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: payload }),
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
        delayMinutes: s.delayMinutes,
      }));
      setSteps(saved);
      setSavedSteps(JSON.stringify(saved));
      setNotice(
        data.repaired
          ? `Saved. ${data.repaired} in-flight recipient${data.repaired === 1 ? "" : "s"} rescheduled.`
          : "Saved.",
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save steps");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndLeave() {
    const destination = pendingLeaveTo;
    if (!destination) return;
    if (!(await saveSteps())) {
      // Close the guard so the error banner underneath is actually readable,
      // and stay put — the edits are still here and still unsaved.
      setPendingLeaveTo(null);
      return;
    }
    setPendingLeaveTo(null);
    router.push(destination);
  }

  function discardAndLeave() {
    const destination = pendingLeaveTo;
    if (!destination) return;
    // Drop the edits before navigating so the beforeunload guard cannot fire
    // on the way out and ask about work the user just chose to throw away.
    setSteps(JSON.parse(savedSteps) as SequenceStepInput[]);
    setPendingLeaveTo(null);
    router.push(destination);
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
      // Unsaved step edits would not be part of what gets published — and a
      // save that failed must not publish the stale server-side copy behind
      // the user's back.
      if (stepsDirty && !(await saveSteps())) return;
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
          : "Sequence disabled. No further emails go out.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update sequence");
    } finally {
      setPublishing(false);
    }
  }

  // Mirrors the API's own rule (app/api/sequences/[sequenceId]/route.ts): a
  // sequence still in draft can never have a real send behind it, since
  // sending only starts once it's published — so draft is exactly the case
  // that gets hard-deleted; anything else is archived (kept for history, no
  // further emails go out) rather than erased.
  const willHardDelete = sequence?.status === "draft";
  // The icon alone can't say which of the two this is, so the tooltip carries
  // the distinction the old menu item's text used to.
  const deleteLabel = titleCase(
    deleting ? "Deleting…" : willHardDelete ? "Delete sequence" : "Archive sequence",
  );

  async function handleDelete() {
    if (deleting || !sequence) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sequences/${encodeURIComponent(sequenceId)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string; deleted?: boolean; archived?: boolean };
      if (!res.ok) throw new Error(data.error || "Could not delete sequence");
      router.push("/sequences");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete sequence");
      setDeleting(false);
      // Close the dialog so the error banner behind it is readable.
      setConfirmingDelete(false);
    }
  }

  function openPreview(index: number) {
    if (previewingIndex === index) {
      setPreviewingIndex(null);
      return;
    }
    setPreviewingIndex(index);
    setPreviewEnrollmentId(null);
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
        variableFallbacks: sequence.variableFallbacks,
      },
      recipient
    );

    // Measured without fallbacks: a chip that vanished the moment you filled
    // it in would leave no way back to change your mind.
    const own = validateMergeTemplates(
      step.subjectTemplate ?? "",
      step.bodyHtml ?? "",
      buildMergeFields(recipient),
    );

    return {
      subject: built.subject,
      html: built.html,
      missing: built.missing,
      missingKeys: own.ok ? [] : own.missing,
      previewFor: recipient.email,
    };
  }, [previewingIndex, previewEnrollmentId, previewRecipients, steps, sequence]);

  /**
   * Which variables are still unfilled for each recipient of the step being
   * previewed — the marker on the rail, so a list of twenty can be scanned
   * without opening each one.
   *
   * Uses the same validateMergeTemplates buildStepEmail runs, rather than a
   * second opinion about what counts as missing, and only merges fields (not
   * the whole body) so a long list stays cheap.
   */
  const missingByRecipient = useMemo(() => {
    const map = new Map<string, string[]>();
    if (previewingIndex === null || !sequence) return map;
    const step = steps[previewingIndex];
    if (!step || step.kind !== "email") return map;

    for (const r of previewRecipients) {
      const fields = buildMergeFields(
        { email: r.email, displayName: r.displayName, mergeFields: r.mergeFields },
        sequence.variableFallbacks,
      );
      const check = validateMergeTemplates(
        step.subjectTemplate ?? "",
        step.bodyHtml ?? "",
        fields,
      );
      if (!check.ok) map.set(r.id, check.missing);
    }
    return map;
  }, [previewingIndex, steps, previewRecipients, sequence]);

  /**
   * Upload one at a time: each file is its own request, so a batch that busts
   * the per-step size cap still lands everything that fits and reports the
   * first refusal instead of failing the lot.
   */
  async function uploadAttachments(stepId: string, files: File[]) {
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/sequences/${encodeURIComponent(sequenceId)}/steps/${encodeURIComponent(stepId)}/attachments`,
        { method: "POST", body: form },
      );
      const data = (await res.json()) as { error?: string; attachment?: SequenceStepAttachment };
      if (!res.ok || !data.attachment) throw new Error(data.error || `Could not attach ${file.name}`);
      const added = data.attachment;
      setAttachmentsByStep((prev) => ({
        ...prev,
        [stepId]: [...(prev[stepId] ?? []), added],
      }));
    }
  }

  async function removeAttachment(stepId: string, attachmentId: string) {
    const res = await fetch(
      `/api/sequences/${encodeURIComponent(sequenceId)}/steps/${encodeURIComponent(stepId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error || "Could not remove the file");
      return;
    }
    setAttachmentsByStep((prev) => ({
      ...prev,
      [stepId]: (prev[stepId] ?? []).filter((a) => a.id !== attachmentId),
    }));
  }

  /**
   * Fallbacks live on the sequence, not in this page's state: the send happens
   * later from cron, so a value typed here has to be readable by the runner.
   */
  function setFallback(key: string, value: string) {
    if (!sequence) return;
    const next = { ...sequence.variableFallbacks };
    if (value.trim()) next[key] = value.trim();
    else delete next[key];
    void patchSequence({ variableFallbacks: next });
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
          {/* The toggle in the header already spells out enabled/disabled, so
              the pill is kept only for the two states it can't express. */}
          {sequence.status === "draft" || sequence.status === "archived" ? (
            <SequenceStatusPill status={sequence.status} />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {/* Always present, never appearing and disappearing under the
              pointer — it only lights up. Clean means the steps on screen are
              the steps on the server, so it says so rather than offering an
              action there is nothing behind. */}
          <button
            data-testid="sequence-save-btn"
            type="button"
            onClick={() => void saveSteps()}
            disabled={!stepsDirty || saving}
            title={
              stepsDirty
                ? titleCase("Save the changes to these steps")
                : titleCase("No unsaved changes")
            }
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-xl px-4 text-[14px] font-semibold transition-colors",
              stepsDirty || saving
                ? "bg-[var(--color-copper)] text-white hover:bg-[var(--color-copper-hover)] disabled:opacity-70"
                : "cursor-default border border-[var(--color-border)] text-[var(--color-text-faint)]",
            )}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : stepsDirty ? (
              <Save className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Check className="h-4 w-4" strokeWidth={2.5} />
            )}
            {titleCase(saving ? "Saving…" : stepsDirty ? "Save changes" : "Saved")}
          </button>
          {/* One switch instead of the old Enable/Pause button: the control
              shows the state it is in ("Enabled"/"Disabled") rather than the
              action it would perform, so the header reads as status. Flipping
              it still hits the same publish/pause API. */}
          <div className="inline-flex h-11 items-center gap-2.5 rounded-xl border border-[var(--color-border)] px-3.5">
            <span
              className={`text-[14px] font-semibold ${
                isActive ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]"
              }`}
            >
              {titleCase(isActive ? "Enabled" : "Disabled")}
            </span>
            <button
              data-testid="sequence-publish-btn"
              type="button"
              role="switch"
              aria-checked={isActive}
              aria-label={titleCase("Sequence enabled")}
              title={titleCase(isActive ? "Disable sequence" : "Enable sequence")}
              onClick={() => void togglePublish(isActive ? "pause" : "publish")}
              disabled={publishing}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
                isActive ? "bg-[var(--color-copper)]" : "bg-[var(--color-border-strong)]"
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow transition-transform ${
                  isActive ? "translate-x-[22px]" : "translate-x-0.5"
                }`}
              >
                {publishing ? (
                  <Loader2 className="h-3 w-3 animate-spin text-[var(--color-text-muted)]" />
                ) : null}
              </span>
            </button>
          </div>
          <button
            data-testid="sequence-delete-btn"
            type="button"
            disabled={deleting}
            onClick={() => setConfirmingDelete(true)}
            title={deleteLabel}
            aria-label={deleteLabel}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors hover:border-[var(--color-danger)]/40 hover:bg-[var(--color-danger)]/5 hover:text-[var(--color-danger)] disabled:opacity-60"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            )}
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
          onPreview={openPreview}
          previewingIndex={previewingIndex}
          previewData={previewData}
          previewRecipients={previewRecipients}
          previewEnrollmentId={previewEnrollmentId}
          onSelectPreviewRecipient={selectPreviewRecipient}
          variables={stepVariables}
          coverage={variableCoverage}
          missingByRecipient={missingByRecipient}
          fallbacks={sequence.variableFallbacks}
          onFallbackChange={setFallback}
          attachmentsByStep={attachmentsByStep}
          onUploadAttachments={uploadAttachments}
          onRemoveAttachment={removeAttachment}
        />
      ) : null}

      {tab === "recipients" ? (
        <SequenceRecipientsTab
          sequence={sequence}
          enrollments={enrollments}
          loading={recipientsLoading}
          // Enrolling or removing changes both the tallies and what the step
          // editor can offer, so one refresh covers the counts and the list.
          onChanged={async () => {
            await Promise.all([load(), loadRecipients()]);
          }}
        />
      ) : null}

      {tab === "settings" ? (
        <SequenceSettingsTab
          sequence={sequence}
          saving={saving}
          onChange={(patch) => void patchSequence(patch)}
        />
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          tone="danger"
          busy={deleting}
          title={willHardDelete ? "Delete this sequence?" : "Archive this sequence?"}
          body={
            willHardDelete
              ? `"${sequence.name}" and its steps will be removed. This can't be undone.`
              : `"${sequence.name}" will be kept for history, but no further emails go out. It won't be deleted outright.`
          }
          confirmLabel={
            deleting ? "Working…" : willHardDelete ? "Delete sequence" : "Archive sequence"
          }
          cancelLabel="Keep it"
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}

      {pendingLeaveTo ? (
        <UnsavedChangesDialog
          saving={saving}
          onSave={() => void saveAndLeave()}
          onDiscard={discardAndLeave}
          onCancel={() => setPendingLeaveTo(null)}
        />
      ) : null}
    </div>
  );
}

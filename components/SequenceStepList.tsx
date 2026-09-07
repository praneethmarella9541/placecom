"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Braces,
  ChevronDown,
  Clock,
  Eye,
  Image as ImageIcon,
  Loader2,
  Mail,
  Paperclip,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/RichTextEditor";
import { SubjectWithVariables, type SubjectHandle } from "@/components/SubjectWithVariables";
import { VariableFallbackChip } from "@/components/VariableFallbackChip";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";
import { listPlaceholdersInTemplate } from "@/lib/mail-merge";
import { describeDelay } from "@/lib/sequence-schedule";
import { SEQUENCE_VARIABLES } from "@/lib/sequence-variables";
import type { SequenceStepAttachment, SequenceStepInput } from "@/lib/sequence-types";
import type { ComposeVariable } from "@/lib/compose-variables";

type PreviewResult = {
  subject: string;
  html: string;
  /** Still unfilled once the sequence's fallbacks are applied. */
  missing: string[];
  /** Unfilled by the recipient's own data — what the fallback chips list. */
  missingKeys: string[];
  previewFor: string;
};
type PreviewRecipient = { id: string; email: string; displayName: string | null };

type Props = {
  steps: SequenceStepInput[];
  businessDaysOnly: boolean;
  threadEmails: boolean;
  disabled?: boolean;
  onChange: (steps: SequenceStepInput[]) => void;
  onPreview: (index: number) => void;
  /** Index of the step currently swapped into the inline "reviewing" pane, or null. */
  previewingIndex: number | null;
  previewData: PreviewResult | null;
  previewRecipients: PreviewRecipient[];
  previewEnrollmentId: string | null;
  onSelectPreviewRecipient: (enrollmentId: string) => void;
  /**
   * Variables offered for this sequence's enrolled recipients — the standard
   * set plus anything extra their stored fields carry. Falls back to the
   * standard set so a sequence with no recipients yet still gets the picker.
   */
  variables?: ComposeVariable[];
  /** Variable key → how many enrolled recipients have a value for it. */
  coverage?: Record<string, number>;
  /** Enrollment id → variables still unfilled for them, after fallbacks. */
  missingByRecipient?: Map<string, string[]>;
  /** Sequence-level fallbacks, and the writer the preview's chips call. */
  fallbacks?: Record<string, string>;
  onFallbackChange?: (key: string, value: string) => void;
  /** Step id → its saved attachments, and the handlers the footer calls. */
  attachmentsByStep?: Record<string, SequenceStepAttachment[]>;
  onUploadAttachments?: (stepId: string, files: File[]) => Promise<void>;
  onRemoveAttachment?: (stepId: string, attachmentId: string) => Promise<void>;
};

/** Sentinel for the "start after enrollment" delay, which has no step index. */
const START_DELAY = -1;

export function SequenceStepList({
  steps,
  businessDaysOnly,
  threadEmails,
  disabled,
  onChange,
  onPreview,
  previewingIndex,
  previewData,
  previewRecipients,
  previewEnrollmentId,
  onSelectPreviewRecipient,
  variables = SEQUENCE_VARIABLES,
  coverage = {},
  missingByRecipient,
  fallbacks = {},
  onFallbackChange,
  attachmentsByStep = {},
  onUploadAttachments,
  onRemoveAttachment,
}: Props) {
  const missingMap = missingByRecipient ?? new Map<string, string[]>();
  // Which delay is expanded — one at a time, so the column of steps stays
  // readable while a duration is being changed.
  const [openDelay, setOpenDelay] = useState<number | null>(null);
  function patch(index: number, next: Partial<SequenceStepInput>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...next } : s)));
  }

  function remove(index: number) {
    // Every index after this one shifts, so an open panel would be pointing at
    // a different step than the one the user opened.
    setOpenDelay(null);

    // Deleting an email takes the delay that led into it. Left behind, that
    // wait silently folds into the one before it — "wait 3" + "wait 5" between
    // two emails that used to be three days apart is now eight, which nobody
    // asked for and nothing on screen explains.
    const removed = steps[index];
    const from =
      removed?.kind === "email" && steps[index - 1]?.kind === "wait" ? index - 1 : index;

    onChange(steps.filter((_, i) => i < from || i > index));
  }

  function add(kind: "email" | "wait") {
    setOpenDelay(null);
    onChange([
      ...steps,
      kind === "email"
        ? { kind: "email", subjectTemplate: "", bodyHtml: "" }
        : { kind: "wait", delayDays: 3, delayHours: 0, delayMinutes: 0 },
    ]);
  }

  // Only the first email carries a subject when the sequence threads — Gmail
  // requires a matching subject to keep replies in the same conversation, so
  // follow-ups reuse "Re: <original>".
  const firstEmailIndex = steps.findIndex((s) => s.kind === "email");

  /**
   * "Start N after enrollment" is not a separate concept in the schema — it is
   * a wait step sitting in front of the first email, which planNextEmailStep
   * already accumulates. No leading wait means the sequence starts as soon as
   * someone is enrolled.
   */
  const leadingWait = steps[0]?.kind === "wait" ? steps[0] : null;

  function setStartDelay(days: number, hours: number, minutes: number) {
    if (leadingWait) {
      patch(0, { delayDays: days, delayHours: hours, delayMinutes: minutes });
      return;
    }
    if (days === 0 && hours === 0 && minutes === 0) return;
    // Adding one in front pushes every other step down a slot.
    if (openDelay !== START_DELAY) setOpenDelay(null);
    onChange([{ kind: "wait", delayDays: days, delayHours: hours, delayMinutes: minutes }, ...steps]);
  }

  /**
   * With no delete button on a delay, clearing it to zero is how it goes away.
   * Applied on blur so the step survives the empty moment between selecting a
   * number and typing its replacement.
   */
  function commitDelay(index: number, days: number, hours: number, minutes: number) {
    if (days > 0 || hours > 0 || minutes > 0) return;
    setOpenDelay(null);
    onChange(steps.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      <DelayControl
        testId="sequence-start-delay"
        icon={Target}
        disabled={disabled}
        open={openDelay === START_DELAY}
        onToggle={() => setOpenDelay(openDelay === START_DELAY ? null : START_DELAY)}
        days={leadingWait?.delayDays ?? 0}
        hours={leadingWait?.delayHours ?? 0}
        minutes={leadingWait?.delayMinutes ?? 0}
        businessDaysOnly={businessDaysOnly}
        onChange={setStartDelay}
        onCommit={(days, hours, minutes) => {
          if (leadingWait) commitDelay(0, days, hours, minutes);
        }}
        summary={
          leadingWait ? (
            <>
              {titleCase("Start")}{" "}
              <b className="font-semibold text-[var(--color-text)]">
                {describeDelay(
                  leadingWait.delayDays ?? 0,
                  leadingWait.delayHours ?? 0,
                  leadingWait.delayMinutes ?? 0,
                  businessDaysOnly,
                )}
              </b>{" "}
              {titleCase("after enrollment")}
            </>
          ) : (
            <>
              {titleCase("Start")}{" "}
              <b className="font-semibold text-[var(--color-text)]">{titleCase("immediately")}</b>{" "}
              {titleCase("after enrollment")}
            </>
          )
        }
      />

      {steps.map((step, index) => {
        // Rendered above as the start control rather than as a step of its own.
        if (index === 0 && leadingWait) return null;
        if (step.kind === "wait") {
          return (
            <div key={index} className="flex flex-col items-center gap-2">
              <ArrowDown className="h-4 w-4 text-[var(--color-text-faint)]" strokeWidth={2} />
              <DelayControl
                testId={`sequence-step-${index}`}
                icon={Clock}
                disabled={disabled}
                open={openDelay === index}
                onToggle={() => setOpenDelay(openDelay === index ? null : index)}
                days={step.delayDays ?? 0}
                hours={step.delayHours ?? 0}
                minutes={step.delayMinutes ?? 0}
                businessDaysOnly={businessDaysOnly}
                onChange={(days, hours, minutes) =>
                  patch(index, { delayDays: days, delayHours: hours, delayMinutes: minutes })
                }
                onCommit={(days, hours, minutes) => commitDelay(index, days, hours, minutes)}
                summary={
                  <>
                    {titleCase("Wait")}{" "}
                    <b className="font-semibold text-[var(--color-text)]">
                      {describeDelay(
                        step.delayDays ?? 0,
                        step.delayHours ?? 0,
                        step.delayMinutes ?? 0,
                        businessDaysOnly,
                      )}
                    </b>
                  </>
                }
              />
            </div>
          );
        }

        const emailNumber = steps.slice(0, index + 1).filter((s) => s.kind === "email").length;
        const subjectLocked = threadEmails && index !== firstEmailIndex;

        return (
          <div key={index} className="flex flex-col items-center gap-2">
            {/* Every block carries the connector into it, so the column reads
                start → email → wait → email without gaps where a delay sits. */}
            <ArrowDown className="h-4 w-4 text-[var(--color-text-faint)]" strokeWidth={2} />
            <div
              data-testid={`sequence-step-${index}`}
              className="w-full overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-copper-tint)] text-[var(--color-copper)]">
                  <Mail className="h-4 w-4" strokeWidth={2} />
                </div>
                <p className="text-[14px] font-semibold text-[var(--color-text)]">
                  {titleCase(`Email ${emailNumber}`)}
                </p>
                {previewingIndex === index ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-copper-tint)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-copper)]">
                    <Eye className="h-3 w-3" strokeWidth={2} />
                    {titleCase("Previewing")}
                  </span>
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onPreview(index)}
                    className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-copper)] hover:bg-[var(--color-copper-tint)]"
                  >
                    {titleCase(previewingIndex === index ? "Back to editing" : "Preview")}
                  </button>
                  {previewingIndex !== index && steps.filter((s) => s.kind === "email").length > 1 ? (
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      disabled={disabled}
                      aria-label="Remove email step"
                      className="rounded-lg p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-danger)] disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  ) : null}
                </div>
              </div>

              {previewingIndex === index ? (
                <SequenceStepPreviewPane
                  data={previewData}
                  recipients={previewRecipients}
                  selectedEnrollmentId={previewEnrollmentId}
                  onSelectRecipient={onSelectPreviewRecipient}
                  missingByRecipient={missingMap}
                  fallbacks={fallbacks}
                  onFallbackChange={onFallbackChange ?? (() => {})}
                />
              ) : (
                <StepComposer
                  index={index}
                  step={step}
                  disabled={disabled}
                  subjectLocked={subjectLocked}
                  variables={variables}
                  coverage={coverage}
                  attachments={step.id ? (attachmentsByStep[step.id] ?? []) : []}
                  onUploadAttachments={onUploadAttachments}
                  onRemoveAttachment={
                    step.id && onRemoveAttachment
                      ? (attachmentId) => onRemoveAttachment(step.id as string, attachmentId)
                      : undefined
                  }
                  onPatch={(next) => patch(index, next)}
                />
              )}
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-center gap-2 pt-1">
        <button
          data-testid="sequence-add-email"
          type="button"
          onClick={() => add("email")}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-offset)] disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          {titleCase("Add email")}
        </button>
        <button
          data-testid="sequence-add-delay"
          type="button"
          onClick={() => add("wait")}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-[13px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-offset)] disabled:opacity-50"
        >
          <Clock className="h-3.5 w-3.5" strokeWidth={2} />
          {titleCase("Add delay")}
        </button>
      </div>
    </div>
  );
}

/**
 * One email step's Subject + Body.
 *
 * Variables are reached the way compose reaches them — the `{` picker, or the
 * `{}` button, which here lives in the editor's own toolbar. The only thing
 * printed outside the editor is a warning, and only when the step uses a
 * variable none of the recipients can fill.
 */
function StepComposer({
  index,
  step,
  disabled,
  subjectLocked,
  variables,
  coverage,
  attachments,
  onUploadAttachments,
  onRemoveAttachment,
  onPatch,
}: {
  index: number;
  step: SequenceStepInput;
  disabled?: boolean;
  subjectLocked: boolean;
  variables: ComposeVariable[];
  coverage: Record<string, number>;
  attachments: SequenceStepAttachment[];
  onUploadAttachments?: (stepId: string, files: File[]) => Promise<void>;
  onRemoveAttachment?: (attachmentId: string) => Promise<void>;
  onPatch: (next: Partial<SequenceStepInput>) => void;
}) {
  const bodyRef = useRef<RichTextEditorHandle>(null);
  const subjectRef = useRef<SubjectHandle>(null);
  /**
   * Which field the caret was last in. The footer button takes focus before
   * its click fires, so "where the cursor is" has to be remembered on focus
   * rather than read at click time — same reason GmailComposeDialog keeps it.
   */
  const lastFocused = useRef<"subject" | "body">("body");
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // A step only gets an id once it has been saved, and the file has to be
  // stored against something — so a brand-new step says so rather than
  // swallowing the click.
  const canAttach = Boolean(step.id) && !disabled && Boolean(onUploadAttachments);
  const attachTitle = step.id
    ? "Attach files"
    : "Save the sequence first — a new step has nowhere to keep files yet";

  async function upload(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length || !step.id || !onUploadAttachments) return;
    setUploading(true);
    setUploadError(null);
    try {
      await onUploadAttachments(step.id, files);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Could not attach file");
    } finally {
      setUploading(false);
    }
  }

  // Variables the step uses that no enrolled recipient can fill. Worth calling
  // out here rather than leaving to the preview: at send time an unfillable
  // placeholder doesn't render blank, it skips the recipient entirely.
  const used = new Set([
    ...listPlaceholdersInTemplate(step.subjectTemplate ?? ""),
    ...listPlaceholdersInTemplate(step.bodyHtml ?? ""),
  ]);
  const unfillable = variables.filter((v) => used.has(v.key) && (coverage[v.key] ?? 0) === 0);

  return (
    <div className="space-y-3 px-5 py-4">
      <div>
        <label className="mb-1 block text-[11.5px] font-medium text-[var(--color-text-muted)]">
          {titleCase("Subject")}
        </label>
        {/* Same picker as the body: `{` opens the menu, tokens are tinted and
            delete as one unit. A threaded follow-up has no subject of its own,
            so it falls back to the plain read-only input. */}
        <div onFocus={() => { lastFocused.current = "subject"; }}>
          <SubjectWithVariables
            ref={subjectRef}
            theme="app"
            testId={`sequence-step-${index}-subject`}
            value={step.subjectTemplate ?? ""}
            disabled={disabled || subjectLocked}
            onChange={(next) => onPatch({ subjectTemplate: next })}
            variables={variables}
            placeholder={
              subjectLocked
                ? "Sent as a reply — keeps the first email's subject"
                : "e.g. Quick question about {company_name}"
            }
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11.5px] font-medium text-[var(--color-text-muted)]">
          {titleCase("Body")}
        </label>
        <div onFocus={() => { lastFocused.current = "body"; }}>
          <RichTextEditor
            ref={bodyRef}
            value={step.bodyHtml ?? ""}
            onChange={(html) => onPatch({ bodyHtml: html })}
            placeholder="Hi {first_name}, …"
            variables={variables}
          />
        </div>

        {/* Compose's footer, under the formatting toolbar: attach, insert
            photo, insert variable. Same three controls, same order, and the
            same behaviour behind them — the photo button is the paperclip
            filtered to images, exactly as GmailComposeDialog wires it. */}
        <div className="flex flex-wrap items-center gap-1 border-t border-[#e8eaed] bg-[#f8f9fa] px-2 py-1.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={photoRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = "";
            }}
          />

          <FooterBtn
            title={attachTitle}
            disabled={!canAttach || uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-[18px] w-[18px] animate-spin" />
            ) : (
              <Paperclip className="h-[18px] w-[18px]" strokeWidth={2} />
            )}
          </FooterBtn>
          <FooterBtn
            title={canAttach ? "Insert photo" : attachTitle}
            disabled={!canAttach || uploading}
            onClick={() => photoRef.current?.click()}
          >
            <ImageIcon className="h-[18px] w-[18px]" strokeWidth={2} />
          </FooterBtn>
          <FooterBtn
            title="Insert variable"
            onClick={() => {
              if (lastFocused.current === "subject" && !subjectLocked) {
                subjectRef.current?.insertVariableTrigger();
              } else {
                bodyRef.current?.insertVariableTrigger();
              }
            }}
          >
            <Braces className="h-[18px] w-[18px]" strokeWidth={2} />
          </FooterBtn>
        </div>

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] py-1 pl-2.5 pr-1.5 text-[12px] text-[var(--color-text)]"
              >
                <Paperclip
                  className="h-3 w-3 shrink-0 text-[var(--color-text-faint)]"
                  strokeWidth={2}
                />
                <span className="truncate">{a.filename}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-[var(--color-text-faint)]">
                  {formatBytes(a.sizeBytes)}
                </span>
                <button
                  type="button"
                  onClick={() => void onRemoveAttachment?.(a.id)}
                  aria-label={`Remove ${a.filename}`}
                  className="shrink-0 rounded p-0.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-danger)]"
                >
                  <X className="h-3 w-3" strokeWidth={2.5} />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {uploadError ? (
          <p className="pt-2 text-[12px] text-[var(--color-danger)]">{uploadError}</p>
        ) : null}
      </div>

      {unfillable.length > 0 ? (
        <p className="rounded-lg bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          {`No recipient has a value for ${unfillable
            .map((v) => `{${v.key}}`)
            .join(", ")} — everyone would be skipped at send time. Set a fallback, or fill it in on their contact card.`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A delay, shown as the sentence it makes ("Wait 3 business days 4 hours")
 * with the numbers tucked behind it.
 *
 * The pill is the resting state — a delay is read far more often than it is
 * changed — and expands to the day/hour steppers underneath. The same control
 * serves the wait steps and the "start after enrollment" delay in front of the
 * first email; only the wording and the remove button differ.
 */
function DelayControl({
  testId,
  icon: Icon,
  summary,
  open,
  onToggle,
  days,
  hours,
  minutes,
  businessDaysOnly,
  disabled,
  onChange,
  onCommit,
}: {
  testId: string;
  icon: React.ElementType;
  summary: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  days: number;
  hours: number;
  minutes: number;
  businessDaysOnly: boolean;
  disabled?: boolean;
  onChange: (days: number, hours: number, minutes: number) => void;
  /**
   * Fired when a field is left, not on every keystroke. Clearing a delay to
   * zero is how it gets removed, and doing that per keystroke would delete the
   * step the moment someone selected "3" to type "5" over it.
   */
  onCommit?: (days: number, hours: number, minutes: number) => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <button
        data-testid={`${testId}-pill`}
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        className={cn(
          "inline-flex max-w-full items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-colors disabled:opacity-50",
          open
            ? "border-[var(--color-copper)] bg-[var(--color-copper-tint)]"
            : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-offset)]",
        )}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            open ? "text-[var(--color-copper)]" : "text-[var(--color-text-muted)]",
          )}
          strokeWidth={2}
        />
        <span className="truncate text-[var(--color-text-muted)]">{summary}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)] transition-transform",
            open && "rotate-180",
          )}
          strokeWidth={2}
        />
      </button>

      {open ? (
        <div className="flex flex-wrap items-center justify-center gap-2.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <DelayNumber
            testId={`${testId}-days`}
            value={days}
            min={0}
            max={365}
            disabled={disabled}
            onChange={(next) => onChange(next, hours, minutes)}
            onCommit={() => onCommit?.(days, hours, minutes)}
          />
          <span className="text-[13px] text-[var(--color-text-muted)]">
            {businessDaysOnly ? titleCase("business days") : titleCase("days")}
          </span>
          <DelayNumber
            testId={`${testId}-hours`}
            value={hours}
            min={0}
            max={23}
            disabled={disabled}
            onChange={(next) => onChange(days, next, minutes)}
            onCommit={() => onCommit?.(days, hours, minutes)}
          />
          <span className="text-[13px] text-[var(--color-text-muted)]">{titleCase("hours")}</span>
          {/* Testing aid — see the 0060 migration header. */}
          <DelayNumber
            testId={`${testId}-minutes`}
            value={minutes}
            min={0}
            max={59}
            disabled={disabled}
            onChange={(next) => onChange(days, hours, next)}
            onCommit={() => onCommit?.(days, hours, minutes)}
          />
          <span className="text-[13px] text-[var(--color-text-muted)]">{titleCase("minutes")}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A number box with its own steppers.
 *
 * Clamped on the way out rather than trusted from the input: a `type=number`
 * field happily reports "" while being edited and accepts anything on paste,
 * and a NaN here would be saved as a delay.
 */
function DelayNumber({
  testId,
  value,
  min,
  max,
  disabled,
  onChange,
  onCommit,
}: {
  testId: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (next: number) => void;
  onCommit?: () => void;
}) {
  return (
    <input
      data-testid={testId}
      type="number"
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const parsed = Number(e.target.value);
        if (!Number.isFinite(parsed)) return onChange(min);
        onChange(Math.max(min, Math.min(max, Math.round(parsed))));
      }}
      onBlur={onCommit}
      className="h-10 w-[72px] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-[14px] font-medium text-[var(--color-text)] outline-none focus:border-[var(--color-copper)] focus:bg-[var(--color-surface)] disabled:opacity-50"
    />
  );
}

/** Compose's footer button, in the sequence editor's step card. */
function FooterBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-full text-[#444746] transition-colors hover:bg-[#e8eaed] disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Inline "reviewing" pane — replaces the step's editable Subject/Body in
 * place, the way mass sending's review screen swaps the same compose surface
 * into read-only merged content rather than opening a separate popup.
 *
 * The recipient rail is that screen's other half: every enrolled recipient
 * listed, the one being previewed highlighted, and a warning marker on anyone
 * whose merged copy still has a hole in it — so checking twenty people is
 * twenty clicks down a visible list rather than twenty trips through a
 * dropdown that shows one name at a time.
 */
function SequenceStepPreviewPane({
  data,
  recipients,
  selectedEnrollmentId,
  onSelectRecipient,
  missingByRecipient,
  fallbacks,
  onFallbackChange,
}: {
  data: {
    subject: string;
    html: string;
    missing: string[];
    missingKeys: string[];
    previewFor: string;
  } | null;
  recipients: { id: string; email: string; displayName: string | null }[];
  selectedEnrollmentId: string | null;
  onSelectRecipient: (enrollmentId: string) => void;
  /** Enrollment id → variables still unfilled for them, after fallbacks. */
  missingByRecipient: Map<string, string[]>;
  fallbacks: Record<string, string>;
  onFallbackChange: (key: string, value: string) => void;
}) {
  const activeId = selectedEnrollmentId ?? recipients[0]?.id ?? null;
  const withGaps = recipients.filter((r) => (missingByRecipient.get(r.id)?.length ?? 0) > 0).length;

  return (
    <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row">
      {recipients.length > 0 ? (
        <aside className="w-full shrink-0 overflow-hidden rounded-xl border border-[var(--color-border)] lg:w-[220px]">
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
            <p className="text-[11.5px] font-semibold text-[var(--color-text)]">
              {titleCase(`Recipients (${recipients.length})`)}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--color-text-faint)]">
              {withGaps > 0
                ? titleCase(`${withGaps} with missing values`)
                : titleCase("No missing values")}
            </p>
          </div>
          <ul className="max-h-[340px] divide-y divide-[var(--color-border)] overflow-y-auto">
            {recipients.map((r) => {
              const missing = missingByRecipient.get(r.id) ?? [];
              const active = r.id === activeId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRecipient(r.id)}
                    title={
                      missing.length
                        ? `${titleCase("Missing")}: ${missing.map((k) => `{${k}}`).join(", ")}`
                        : undefined
                    }
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                      active
                        ? "bg-[var(--color-copper-tint)]"
                        : "hover:bg-[var(--color-surface-offset)]",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-[12.5px] font-medium",
                          active ? "text-[var(--color-copper)]" : "text-[var(--color-text)]",
                        )}
                      >
                        {r.displayName?.trim() || r.email}
                      </span>
                      {r.displayName?.trim() ? (
                        <span className="font-mono block truncate text-[11px] text-[var(--color-text-faint)]">
                          {r.email}
                        </span>
                      ) : null}
                    </span>
                    {missing.length > 0 ? (
                      <AlertTriangle
                        className="h-3.5 w-3.5 shrink-0 text-amber-500"
                        strokeWidth={2}
                      />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      ) : null}

      <div className="min-w-0 flex-1">
        {recipients.length === 0 ? (
          <p className="mb-3 text-[12px] text-[var(--color-text-faint)]">
            {titleCase("No recipients yet — showing sample data")}
          </p>
        ) : null}

        {!data ? null : (
          <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-3">
              <p className="truncate text-[14px] font-semibold text-[var(--color-text)]">
                {data.subject || titleCase("(no subject)")}
              </p>
              <p className="font-mono mt-0.5 truncate text-[11.5px] text-[var(--color-text-faint)]">
                {titleCase("To")} {data.previewFor}
              </p>
            </div>

            {/* Same affordance as the mass-send review screen: the hole is
                shown where it is, and clicking it sets the value everyone
                without their own gets. Saved on the sequence, so the cron
                uses it too. */}
            {data.missingKeys.length > 0 ? (
              <div
                className={cn(
                  "flex flex-wrap items-center gap-1.5 border-b border-[var(--color-border)] px-4 py-2.5 text-[12px]",
                  data.missing.length > 0
                    ? "bg-amber-500/5 text-amber-700 dark:text-amber-400"
                    : "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
                )}
              >
                <span>
                  {titleCase(
                    data.missing.length > 0
                      ? "Nothing to merge for this recipient — set a fallback or they'll be skipped"
                      : "Filled by fallback for this recipient",
                  )}
                  :
                </span>
                {data.missingKeys.map((key) => (
                  <VariableFallbackChip
                    key={key}
                    theme="app"
                    variableKey={key}
                    value={fallbacks[key] ?? ""}
                    onChange={(next) => onFallbackChange(key, next)}
                    hint="Used for every recipient in this sequence with no value of their own."
                  />
                ))}
              </div>
            ) : null}

            <div
              className="prose-sm max-w-none bg-[var(--color-surface)] px-4 py-4 text-[14px] text-[var(--color-text)]"
              dangerouslySetInnerHTML={{ __html: data.html }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

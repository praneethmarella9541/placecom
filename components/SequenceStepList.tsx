"use client";

import { ArrowDown, Clock, Mail, Plus, Trash2 } from "lucide-react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";
import { describeDelay } from "@/lib/sequence-schedule";
import type { SequenceStepInput } from "@/lib/sequence-types";

const MERGE_FIELDS = ["first_name", "last_name", "name", "email", "company"] as const;

type Props = {
  steps: SequenceStepInput[];
  businessDaysOnly: boolean;
  threadEmails: boolean;
  disabled?: boolean;
  onChange: (steps: SequenceStepInput[]) => void;
  onPreview: (index: number) => void;
};

export function SequenceStepList({
  steps,
  businessDaysOnly,
  threadEmails,
  disabled,
  onChange,
  onPreview,
}: Props) {
  function patch(index: number, next: Partial<SequenceStepInput>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...next } : s)));
  }

  function remove(index: number) {
    onChange(steps.filter((_, i) => i !== index));
  }

  function add(kind: "email" | "wait") {
    onChange([
      ...steps,
      kind === "email"
        ? { kind: "email", subjectTemplate: "", bodyHtml: "" }
        : { kind: "wait", delayDays: 3, delayHours: 0 },
    ]);
  }

  // Only the first email carries a subject when the sequence threads — Gmail
  // requires a matching subject to keep replies in the same conversation, so
  // follow-ups reuse "Re: <original>".
  const firstEmailIndex = steps.findIndex((s) => s.kind === "email");

  return (
    <div className="space-y-3">
      {steps.map((step, index) => {
        if (step.kind === "wait") {
          return (
            <div key={index} className="flex flex-col items-center gap-2">
              <ArrowDown className="h-4 w-4 text-[var(--color-text-faint)]" strokeWidth={2} />
              <div className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3.5">
                <Clock className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" strokeWidth={2} />
                <span className="text-[13px] font-medium text-[var(--color-text-muted)]">
                  {titleCase("Wait")}
                </span>
                <input
                  data-testid={`sequence-step-${index}-days`}
                  type="number"
                  min={0}
                  max={365}
                  value={step.delayDays ?? 0}
                  disabled={disabled}
                  onChange={(e) => patch(index, { delayDays: Number(e.target.value) })}
                  className="h-9 w-16 rounded-lg border border-transparent bg-[var(--color-surface-2)] px-2.5 text-center text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-copper)]"
                />
                <span className="text-[13px] text-[var(--color-text-muted)]">
                  {businessDaysOnly ? titleCase("business days") : titleCase("days")}
                </span>
                <input
                  data-testid={`sequence-step-${index}-hours`}
                  type="number"
                  min={0}
                  max={23}
                  value={step.delayHours ?? 0}
                  disabled={disabled}
                  onChange={(e) => patch(index, { delayHours: Number(e.target.value) })}
                  className="h-9 w-16 rounded-lg border border-transparent bg-[var(--color-surface-2)] px-2.5 text-center text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-copper)]"
                />
                <span className="text-[13px] text-[var(--color-text-muted)]">
                  {titleCase("hours")}
                </span>
                <span className="ml-auto font-mono text-[11.5px] text-[var(--color-text-faint)]">
                  {describeDelay(step.delayDays ?? 0, step.delayHours ?? 0, businessDaysOnly)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={disabled}
                  aria-label="Remove delay"
                  className="rounded-lg p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-danger)] disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            </div>
          );
        }

        const emailNumber = steps.slice(0, index + 1).filter((s) => s.kind === "email").length;
        const subjectLocked = threadEmails && index !== firstEmailIndex;

        return (
          <div key={index} className="flex flex-col items-center gap-2">
            {index > 0 && steps[index - 1].kind === "email" ? (
              <ArrowDown className="h-4 w-4 text-[var(--color-text-faint)]" strokeWidth={2} />
            ) : null}
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
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onPreview(index)}
                    className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-copper)] hover:bg-[var(--color-copper-tint)]"
                  >
                    {titleCase("Preview")}
                  </button>
                  {steps.filter((s) => s.kind === "email").length > 1 ? (
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

              <div className="space-y-3 px-5 py-4">
                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--color-text-muted)]">
                    {titleCase("Subject")}
                  </label>
                  <input
                    data-testid={`sequence-step-${index}-subject`}
                    type="text"
                    value={step.subjectTemplate ?? ""}
                    disabled={disabled || subjectLocked}
                    onChange={(e) => patch(index, { subjectTemplate: e.target.value })}
                    placeholder={
                      subjectLocked
                        ? "Sent as a reply — keeps the first email's subject"
                        : "e.g. Quick question about {{company}}"
                    }
                    className={cn(
                      "h-11 w-full rounded-xl border border-transparent bg-[var(--color-surface-2)] px-4 text-[14px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)] focus:border-[var(--color-copper)] focus:bg-[var(--color-surface)]",
                      subjectLocked && "opacity-60",
                    )}
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11.5px] font-medium text-[var(--color-text-muted)]">
                    {titleCase("Body")}
                  </label>
                  <RichTextEditor
                    value={step.bodyHtml ?? ""}
                    onChange={(html) => patch(index, { bodyHtml: html })}
                    placeholder="Hi {{first_name}}, …"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] text-[var(--color-text-faint)]">
                    {titleCase("Variables")}:
                  </span>
                  {MERGE_FIELDS.map((field) => (
                    <code
                      key={field}
                      className="rounded-md bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-muted)]"
                    >
                      {`{{${field}}}`}
                    </code>
                  ))}
                </div>
              </div>
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

"use client";

import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Clock, Trash2 } from "lucide-react";
import { DelayControl } from "@/components/SequenceStepList";
import { describeDelay } from "@/lib/sequence-schedule";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/RichTextEditor";
import { SubjectWithVariables, type SubjectHandle } from "@/components/SubjectWithVariables";
import type { ComposeVariable, UnknownPlaceholderMode } from "@/lib/compose-variables";
import type { FollowUpDraft } from "@/lib/schedule-flow";

export type ScheduleFollowUpEditorHandle = {
  /** Opens the `{` variable picker in whichever field the caret is in (body by default). */
  insertVariableTrigger: () => void;
};

type Props = {
  index: number;
  followUp: FollowUpDraft;
  /** Subject of the first email — shown as the thread a threaded follow-up replies to. */
  firstSubject: string;
  threadEmails: boolean;
  businessDaysOnly: boolean;
  variables: ComposeVariable[];
  unknownPlaceholders?: UnknownPlaceholderMode;
  onChange: (patch: Partial<FollowUpDraft>) => void;
  onRemove: () => void;
};

/**
 * Replaces the composer's subject and body while a follow-up is selected: how long to wait, an
 * optional subject (only when follow-ups are not threaded), and the message. Variables work the
 * same as in the first email.
 */
export const ScheduleFollowUpEditor = forwardRef<ScheduleFollowUpEditorHandle, Props>(
  function ScheduleFollowUpEditor(
    { index, followUp, firstSubject, threadEmails, businessDaysOnly, variables, unknownPlaceholders, onChange, onRemove },
    ref,
  ) {
    const editorRef = useRef<RichTextEditorHandle>(null);
    const subjectRef = useRef<SubjectHandle>(null);
    const lastFocused = useRef<"subject" | "body">("body");

    useImperativeHandle(ref, () => ({
      insertVariableTrigger: () => {
        if (lastFocused.current === "subject" && !threadEmails) subjectRef.current?.insertVariableTrigger();
        else editorRef.current?.insertVariableTrigger();
      },
    }));

    // Open on arrival so the wait is plainly editable; the pill folds it back to a sentence.
    const [delayOpen, setDelayOpen] = useState(true);

    return (
      <div className="flex min-h-0 flex-1 flex-col" data-testid={`schedule-followup-${index + 1}`}>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-[#f1f3f4] bg-[#faf8f5] px-3 py-3">
          <DelayControl
            testId={`schedule-followup-${index + 1}-delay`}
            icon={Clock}
            align="start"
            open={delayOpen}
            onToggle={() => setDelayOpen((o) => !o)}
            days={followUp.delayDays}
            hours={followUp.delayHours}
            minutes={followUp.delayMinutes}
            businessDaysOnly={businessDaysOnly}
            onChange={(delayDays, delayHours, delayMinutes) => onChange({ delayDays, delayHours, delayMinutes })}
            summary={
              <>
                Send{" "}
                <b className="font-semibold text-[var(--color-text)]">
                  {describeDelay(followUp.delayDays, followUp.delayHours, followUp.delayMinutes, businessDaysOnly)}
                </b>{" "}
                after the previous email
              </>
            }
          />
          <p className="order-last basis-full text-[12px] text-[var(--color-text-muted)] sm:order-none sm:basis-auto sm:self-center">
            Only if they haven&apos;t replied.
          </p>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-[#c5221f] hover:bg-[#fce8e6]"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
            Remove follow-up
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-[#f1f3f4] px-3 py-2.5">
          {threadEmails ? (
            <>
              <span className="w-14 shrink-0 text-[13px] text-[#444746]">Subject</span>
              <span className="truncate text-[14px] text-[#5f6368]">
                Re: {firstSubject.trim() || "(subject of the first email)"} — sent in the same thread
              </span>
            </>
          ) : (
            <div className="w-full" onFocusCapture={() => { lastFocused.current = "subject"; }}>
              <SubjectWithVariables
                ref={subjectRef}
                value={followUp.subject}
                onChange={(subject) => onChange({ subject })}
                placeholder="Subject"
                variables={variables}
                unknownPlaceholders={unknownPlaceholders}
              />
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col" onFocusCapture={() => { lastFocused.current = "body"; }}>
          <RichTextEditor
            ref={editorRef}
            value={followUp.bodyHtml}
            onChange={(bodyHtml) => onChange({ bodyHtml })}
            placeholder="Write the follow-up. Type { to personalise it."
            variables={variables}
            unknownPlaceholders={unknownPlaceholders}
          />
        </div>
      </div>
    );
  },
);

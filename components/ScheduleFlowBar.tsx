"use client";

import { ArrowDown, ChevronDown, Clock, Mail, Plus, Settings2, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { scheduleStartLabel } from "@/components/ScheduleSettingsPanel";
import { MAX_FOLLOW_UPS, followUpSendLabel, type ScheduleFlowState } from "@/lib/schedule-flow";

export type ScheduleTab = "editor" | "settings";

type Common = {
  flow: ScheduleFlowState;
  /** 0 = the composer's own email; n = follow-up n. */
  activeStep: number;
  onSelectStep: (step: number) => void;
  disabled?: boolean;
  /** The first email, for its collapsed card (the composer itself holds the live editor). */
  firstSubject: string;
  firstBodyHtml: string;
};

type BarProps = Common & {
  tab: ScheduleTab;
  onTabChange: (tab: ScheduleTab) => void;
  /** Recipients who will be skipped at a step because a merge field has no value for them. */
  warnings?: string[];
};

type TailProps = Common & {
  onAddFollowUp: () => void;
};

function textOf(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function nodeLabel(step: number): string {
  return step === 0 ? "Email 1" : `Follow-up ${step}`;
}

/** What a collapsed email card says about itself: its subject (or thread note) and the start of its body. */
function nodePreview(step: number, p: Common): string {
  if (step === 0) {
    return [p.firstSubject.trim(), textOf(p.firstBodyHtml)].filter(Boolean).join(" — ") || "Nothing written yet";
  }
  const f = p.flow.followUps[step - 1];
  if (!f) return "";
  const body = textOf(f.bodyHtml);
  const subject = p.flow.threadEmails ? "Reply in the same thread" : f.subject.trim();
  return [subject, body].filter(Boolean).join(" — ") || "Nothing written yet";
}

/**
 * The top of a scheduled flow in the composer: the Editor / Settings tabs, then (on the Editor tab)
 * the timeline down to the email being edited — start → email → wait → email … — laid out like the
 * Sequences editor. The email being edited sits right below this, in the composer's own editor;
 * ScheduleFlowTail draws the rest of the timeline under it.
 */
export function ScheduleFlowBar(props: BarProps) {
  const { flow, activeStep, onSelectStep, tab, onTabChange, warnings = [], disabled } = props;

  return (
    <div
      className={cn("shrink-0 bg-[#faf8f5]", tab === "settings" && "border-b border-[#f1f3f4]")}
      data-testid="schedule-flow-bar"
    >
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-3" role="tablist">
        {(
          [
            { id: "editor" as const, label: "Editor", icon: Mail },
            { id: "settings" as const, label: "Settings", icon: Settings2 },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTabChange(id)}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
              tab === id
                ? "border-[var(--color-copper)] text-[var(--color-copper)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            <Icon className="h-4 w-4" strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>

      {tab === "editor" && (
        <div className="flex flex-col items-center gap-2 px-3 pt-3">
          <button
            type="button"
            onClick={() => onTabChange("settings")}
            disabled={disabled}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-[13px] transition-colors hover:bg-[var(--color-surface-offset)] disabled:opacity-50"
            title="Change when it starts, the sending window and reply rules"
          >
            <Target className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" strokeWidth={2} />
            <span className="truncate font-semibold text-[var(--color-text)]">{scheduleStartLabel(flow)}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" strokeWidth={2} />
          </button>

          {Array.from({ length: activeStep }, (_, k) => (
            <div key={k} className="flex w-full flex-col items-center gap-2">
              {k > 0 && <WaitPill flow={flow} step={k} onSelectStep={onSelectStep} />}
              <ArrowDown className="h-4 w-4 text-[var(--color-text-faint)]" strokeWidth={2} />
              <CollapsedCard step={k} p={props} />
            </div>
          ))}
          <ArrowDown className="h-4 w-4 text-[var(--color-text-faint)]" strokeWidth={2} />
          <div className="flex w-full items-center gap-3 rounded-t-2xl border border-b-0 border-[var(--color-copper)] bg-white px-4 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-copper-tint)] text-[var(--color-copper)]">
              <Mail className="h-4 w-4" strokeWidth={2} />
            </span>
            <p className="text-[14px] font-semibold text-[var(--color-text)]">{nodeLabel(activeStep)}</p>
            <span className="text-[12px] text-[var(--color-text-muted)]">Editing</span>
          </div>
        </div>
      )}

      {warnings.length > 0 && tab === "editor" && (
        <ul className="mt-3 space-y-0.5 border-t border-[#f1f3f4] bg-[#fef7e0] px-3 py-2 text-[12px] leading-snug text-[#b06000]">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The rest of the timeline, under the email being edited: later waits and emails, then "Add follow-up". */
export function ScheduleFlowTail(props: TailProps) {
  const { flow, activeStep, onSelectStep, onAddFollowUp, disabled } = props;
  const last = flow.followUps.length;

  return (
    <div className="flex shrink-0 flex-col items-center gap-2 bg-[#faf8f5] px-3 pb-4 pt-2" data-testid="schedule-flow-tail">
      {Array.from({ length: last - activeStep }, (_, i) => {
        const k = activeStep + 1 + i;
        return (
          <div key={k} className="flex w-full flex-col items-center gap-2">
            <ArrowDown className="h-4 w-4 text-[var(--color-text-faint)]" strokeWidth={2} />
            <WaitPill flow={flow} step={k} onSelectStep={onSelectStep} />
            <ArrowDown className="h-4 w-4 text-[var(--color-text-faint)]" strokeWidth={2} />
            <CollapsedCard step={k} p={props} />
          </div>
        );
      })}
      <ArrowDown className="h-4 w-4 text-[var(--color-text-faint)]" strokeWidth={2} />
      <button
        type="button"
        disabled={disabled || last >= MAX_FOLLOW_UPS}
        onClick={onAddFollowUp}
        className="flex items-center gap-1.5 rounded-full border border-dashed border-[#bdc1c6] bg-white px-4 py-2 text-[13px] font-medium text-[#3c4043] hover:bg-[#f1f3f4] disabled:cursor-not-allowed disabled:opacity-50"
        title="Send another email if they haven't replied"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
        Add follow-up
      </button>
    </div>
  );
}

/** The wait before follow-up `step`, read-only here; it is edited in that follow-up's own header. */
function WaitPill({
  flow,
  step,
  onSelectStep,
}: {
  flow: ScheduleFlowState;
  step: number;
  onSelectStep: (step: number) => void;
}) {
  const f = flow.followUps[step - 1];
  if (!f) return null;
  return (
    <button
      type="button"
      onClick={() => onSelectStep(step)}
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-[13px] transition-colors hover:bg-[var(--color-surface-offset)]"
      title="Open this follow-up to change when it goes out"
    >
      <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" strokeWidth={2} />
      <span className="truncate text-[var(--color-text-muted)]">
        Send <b className="font-semibold text-[var(--color-text)]">{followUpSendLabel(flow, step - 1)}</b>
      </span>
    </button>
  );
}

function CollapsedCard({ step, p }: { step: number; p: Common }) {
  return (
    <button
      type="button"
      onClick={() => p.onSelectStep(step)}
      className="flex w-full items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-left transition-colors hover:bg-[var(--color-surface-offset)]"
      aria-label={`Edit ${nodeLabel(step)}`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-copper-tint)] text-[var(--color-copper)]">
        <Mail className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-[var(--color-text)]">{nodeLabel(step)}</span>
        <span className="block truncate text-[12.5px] text-[var(--color-text-muted)]">{nodePreview(step, p)}</span>
      </span>
      <span className="shrink-0 text-[12px] font-medium text-[var(--color-copper)]">Edit</span>
    </button>
  );
}

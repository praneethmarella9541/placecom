"use client";

import { useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_FOLLOW_UPS,
  followUpDelayLabel,
  scheduleSummary,
  type ScheduleFlowState,
} from "@/lib/schedule-flow";

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

type Props = {
  flow: ScheduleFlowState;
  onChange: (patch: Partial<ScheduleFlowState>) => void;
  /** 0 = the composer's own email; n = follow-up n. */
  activeStep: number;
  onSelectStep: (step: number) => void;
  onAddFollowUp: () => void;
  /** Recipients who will be skipped at a step because a merge field has no value for them. */
  warnings?: string[];
  disabled?: boolean;
};

/**
 * The strip above the editor when Scheduling is on: Email 1 → wait → Follow-up 1 → …, plus the
 * options (start time, stop on reply, send window). The email being edited is chosen here; the
 * composer's own editor is Email 1, follow-ups edit in ScheduleFollowUpEditor.
 */
export function ScheduleFlowBar({
  flow,
  onChange,
  activeStep,
  onSelectStep,
  onAddFollowUp,
  warnings = [],
  disabled,
}: Props) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const zones = TIMEZONES.includes(flow.timezone) ? TIMEZONES : [flow.timezone, ...TIMEZONES];

  return (
    <div className="shrink-0 border-b border-[#f1f3f4] bg-[#faf8f5]" data-testid="schedule-flow-bar">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 px-3 py-2">
        <span className="mr-1 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-copper)]">
          <CalendarClock className="h-4 w-4" strokeWidth={2} />
          Schedule
        </span>

        <StepChip label="Email 1" active={activeStep === 0} onClick={() => onSelectStep(0)} />
        {flow.followUps.map((f, i) => (
          <span key={f.id} className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#5f6368]">
              wait {followUpDelayLabel(f, flow.businessDaysOnly)} →
            </span>
            <StepChip
              label={`Follow-up ${i + 1}`}
              active={activeStep === i + 1}
              onClick={() => onSelectStep(i + 1)}
            />
          </span>
        ))}

        <button
          type="button"
          disabled={disabled || flow.followUps.length >= MAX_FOLLOW_UPS}
          onClick={onAddFollowUp}
          className="flex items-center gap-1 rounded-full border border-dashed border-[#bdc1c6] px-2.5 py-1 text-[12px] font-medium text-[#3c4043] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          title="Send another email if they haven't replied"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
          Follow-up
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => setOptionsOpen((o) => !o)}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium text-[#3c4043] hover:bg-white"
          aria-expanded={optionsOpen}
        >
          Options
          {optionsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      <p className="px-3 pb-2 text-[11.5px] text-[#5f6368]">{scheduleSummary(flow)}</p>

      {optionsOpen && (
        <div className="scrollbar-thin grid max-h-[38vh] gap-x-6 gap-y-3 overflow-y-auto border-t border-[#f1f3f4] bg-white px-3 py-3 text-[12.5px] text-[#3c4043] sm:grid-cols-2">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#5f6368]">Start</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="schedule-start"
                checked={flow.startMode === "now"}
                disabled={disabled}
                onChange={() => onChange({ startMode: "now" })}
              />
              As soon as possible
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input
                type="radio"
                name="schedule-start"
                checked={flow.startMode === "later"}
                disabled={disabled}
                onChange={() => onChange({ startMode: "later" })}
              />
              On
              <input
                type="datetime-local"
                value={flow.startLocal}
                disabled={disabled}
                onFocus={() => onChange({ startMode: "later" })}
                onChange={(e) => onChange({ startMode: "later", startLocal: e.target.value })}
                className="rounded border border-[#dadce0] px-2 py-1 text-[12.5px]"
              />
            </label>
            <p className="text-[11px] text-[#5f6368]">
              Mails only go out inside the send window below, so a start outside it moves to the next opening.
            </p>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#5f6368]">Stop when</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={flow.exitOnReply}
                disabled={disabled}
                onChange={(e) => onChange({ exitOnReply: e.target.checked })}
              />
              The recipient replies
            </label>
            <label className="flex items-center gap-2 text-[#80868b]">
              <input type="checkbox" checked disabled />
              The address bounces (always)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={flow.threadEmails}
                disabled={disabled}
                onChange={(e) => onChange({ threadEmails: e.target.checked })}
              />
              Send follow-ups as replies in the same thread
            </label>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#5f6368]">Send window</legend>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={flow.windowStart}
                disabled={disabled}
                onChange={(e) => onChange({ windowStart: e.target.value })}
                className="rounded border border-[#dadce0] px-2 py-1"
                aria-label="Window starts"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              to
              <select
                value={flow.windowEnd}
                disabled={disabled}
                onChange={(e) => onChange({ windowEnd: e.target.value })}
                className="rounded border border-[#dadce0] px-2 py-1"
                aria-label="Window ends"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
            <select
              value={flow.timezone}
              disabled={disabled}
              onChange={(e) => onChange({ timezone: e.target.value })}
              className="w-full rounded border border-[#dadce0] px-2 py-1"
              aria-label="Time zone"
            >
              {zones.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={flow.businessDaysOnly}
                disabled={disabled}
                onChange={(e) => onChange({ businessDaysOnly: e.target.checked })}
              />
              Weekdays only (waits count business days)
            </label>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#5f6368]">Pace</legend>
            <label className="flex items-center gap-2">
              At most
              <input
                type="number"
                min={1}
                max={2000}
                value={flow.dailyLimit}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ dailyLimit: Math.min(2000, Math.max(1, Math.floor(Number(e.target.value)) || 1)) })
                }
                className="w-20 rounded border border-[#dadce0] px-2 py-1"
              />
              emails a day
            </label>
            <p className="text-[11px] text-[#5f6368]">
              A bigger audience is spread over several days automatically, which keeps Gmail happy.
            </p>
          </fieldset>
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-0.5 border-t border-[#f1f3f4] bg-[#fef7e0] px-3 py-2 text-[12px] leading-snug text-[#b06000]">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-[12px] font-medium transition-colors",
        active
          ? "bg-[var(--color-copper)] text-white"
          : "border border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f1f3f4]",
      )}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

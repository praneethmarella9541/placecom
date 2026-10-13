"use client";

import { useState } from "react";
import { CalendarClock, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { GmailDatePicker } from "@/components/GmailDatePicker";
import { isoDateLocal } from "@/lib/gmail-search-query";
import {
  MAX_FOLLOW_UPS,
  followUpDelayLabel,
  scheduleSummary,
  type ScheduleFlowState,
} from "@/lib/schedule-flow";

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

const HOURS_12 = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES_60 = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

/** "HH:mm" (24-hour) → the three parts the start-time dropdowns edit. */
function splitTime(value: string): { hour12: number; minute: string; pm: boolean } {
  const h = Number(value.slice(0, 2)) || 0;
  return { hour12: h % 12 === 0 ? 12 : h % 12, minute: value.slice(3, 5) || "00", pm: h >= 12 };
}

function joinTime(hour12: number, minute: string, pm: boolean): string {
  const h = (hour12 % 12) + (pm ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${minute}`;
}

function hourLabel(value: string): string {
  const h = Number(value.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
}

// `input-field` is full-width by default; the time dropdowns want a compact fixed width.
const timeSelectClass =
  "input-field h-9 !w-[58px] rounded-lg px-1.5 text-[13px] text-[#202124] disabled:cursor-not-allowed disabled:opacity-60";
const selectClass =
  "input-field h-9 !w-[116px] rounded-lg px-2 text-[13px] text-[#202124] disabled:cursor-not-allowed disabled:opacity-60";

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
  // The start is stored as one "YYYY-MM-DDTHH:mm" value; the date and time are edited separately.
  const startDate = flow.startLocal.slice(0, 10);
  const startTime = flow.startLocal.slice(11, 16) || "09:00";
  const startParts = splitTime(startTime);
  const setStartTime = (next: string) =>
    onChange({ startMode: "later", startLocal: `${startDate || isoDateLocal(new Date())}T${next}` });

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
        <div className="grid gap-x-6 gap-y-3 border-t border-[#f1f3f4] bg-white px-3 py-3 text-[12.5px] text-[#3c4043] sm:grid-cols-2">
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
              <GmailDatePicker
                className="w-[150px]"
                value={startDate}
                onChange={(d) => onChange({ startMode: "later", startLocal: `${d}T${startTime}` })}
              />
              <span className="flex items-center gap-1">
                <select
                  value={startParts.hour12}
                  disabled={disabled}
                  onChange={(e) => setStartTime(joinTime(Number(e.target.value), startParts.minute, startParts.pm))}
                  className={timeSelectClass}
                  aria-label="Start hour"
                >
                  {HOURS_12.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                :
                <select
                  value={startParts.minute}
                  disabled={disabled}
                  onChange={(e) => setStartTime(joinTime(startParts.hour12, e.target.value, startParts.pm))}
                  className={timeSelectClass}
                  aria-label="Start minute"
                >
                  {MINUTES_60.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <select
                  value={startParts.pm ? "PM" : "AM"}
                  disabled={disabled}
                  onChange={(e) => setStartTime(joinTime(startParts.hour12, startParts.minute, e.target.value === "PM"))}
                  className={timeSelectClass}
                  aria-label="AM or PM"
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                </select>
              </span>
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
                className={selectClass}
                aria-label="Window starts"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </select>
              to
              <select
                value={flow.windowEnd}
                disabled={disabled}
                onChange={(e) => onChange({ windowEnd: e.target.value })}
                className={selectClass}
                aria-label="Window ends"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>{hourLabel(h)}</option>
                ))}
              </select>
            </div>
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

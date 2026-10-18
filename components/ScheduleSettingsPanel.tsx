"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { GmailDatePicker } from "@/components/GmailDatePicker";
import { Section, Toggle } from "@/components/SettingsControls";
import { TimeFields } from "@/components/TimeFields";
import { isoDateLocal } from "@/lib/gmail-search-query";
import { scheduleSummary, type ScheduleFlowState } from "@/lib/schedule-flow";

/** Today's date as "YYYY-MM-DD" on the wall clock of `timeZone`. */
function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return isoDateLocal(new Date());
  }
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The start presets, as wall-clock values in the flow's zone. "Next Monday" is always a future Monday. */
function startPresets(timeZone: string): { tomorrow: string; monday: string } {
  const today = todayIn(timeZone);
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const untilMonday = ((8 - dow) % 7) || 7;
  return { tomorrow: `${addDays(today, 1)}T09:00`, monday: `${addDays(today, untilMonday)}T09:00` };
}

/** "Starts now" / "Starts Mon, 20 Oct, 9:00 am" — the first part of the flow's summary line. */
export function scheduleStartLabel(flow: ScheduleFlowState): string {
  return scheduleSummary(flow).split(" · ")[0];
}

type Props = {
  flow: ScheduleFlowState;
  onChange: (patch: Partial<ScheduleFlowState>) => void;
  disabled?: boolean;
};

/**
 * The Settings tab of a scheduled flow: when it starts, when mail may go out, and how it reacts to
 * replies. Same cards and switches as the Sequences editor's Settings tab.
 */
export function ScheduleSettingsPanel({ flow, onChange, disabled }: Props) {
  // The start is stored as one "YYYY-MM-DDTHH:mm" value; the date and time are edited separately.
  const startDate = flow.startLocal.slice(0, 10);
  const startTime = flow.startLocal.slice(11, 16) || "09:00";
  const presets = startPresets(flow.timezone);
  const startChoice: "now" | "tomorrow" | "monday" | "custom" =
    flow.startMode === "now"
      ? "now"
      : flow.startLocal === presets.tomorrow
        ? "tomorrow"
        : flow.startLocal === presets.monday
          ? "monday"
          : "custom";
  // "Pick date & time" stays highlighted once chosen, even if the value happens to match a preset.
  const [customOpen, setCustomOpen] = useState(startChoice === "custom");
  const showCustom = customOpen || startChoice === "custom";
  const setStartTime = (next: string) =>
    onChange({ startMode: "later", startLocal: `${startDate || isoDateLocal(new Date())}T${next}` });

  return (
    <div className="space-y-4 bg-[#faf8f5] p-4" data-testid="schedule-settings">
      <Section title="Start">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Start time">
          <PresetPill
            label="Starts now"
            selected={startChoice === "now" && !showCustom}
            disabled={disabled}
            onClick={() => {
              setCustomOpen(false);
              onChange({ startMode: "now" });
            }}
          />
          <PresetPill
            label="Tomorrow, 9:00 AM"
            selected={startChoice === "tomorrow" && !showCustom}
            disabled={disabled}
            onClick={() => {
              setCustomOpen(false);
              onChange({ startMode: "later", startLocal: presets.tomorrow });
            }}
          />
          <PresetPill
            label="Next Monday, 9:00 AM"
            selected={startChoice === "monday" && !showCustom}
            disabled={disabled}
            onClick={() => {
              setCustomOpen(false);
              onChange({ startMode: "later", startLocal: presets.monday });
            }}
          />
          <PresetPill
            label="Pick date & time…"
            selected={showCustom}
            disabled={disabled}
            onClick={() => {
              setCustomOpen(true);
              onChange({
                startMode: "later",
                startLocal: flow.startLocal || presets.tomorrow,
              });
            }}
          />
        </div>
        {showCustom && (
          <div className="flex flex-wrap items-center gap-2">
            <GmailDatePicker
              className="w-full sm:w-[170px]"
              value={startDate}
              onChange={(d) => onChange({ startMode: "later", startLocal: `${d}T${startTime}` })}
            />
            <TimeFields value={startTime} disabled={disabled} onChange={setStartTime} />
          </div>
        )}
      </Section>

      <Section title="Replies">
        <Toggle
          testId="schedule-exit-on-reply"
          label="Stop when someone replies"
          hint="As soon as a reply lands, that recipient gets no further emails. A bounced address always stops the flow."
          checked={flow.exitOnReply}
          disabled={disabled}
          onChange={(v) => onChange({ exitOnReply: v })}
        />
        <Toggle
          testId="schedule-thread-emails"
          label="Thread emails"
          hint="Send each follow-up as a reply on the same conversation, keeping the first subject."
          checked={flow.threadEmails}
          disabled={disabled}
          onChange={(v) => onChange({ threadEmails: v })}
        />
      </Section>
    </div>
  );
}

function PresetPill({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        selected
          ? "border-[var(--color-copper)] bg-[var(--color-copper)] text-white"
          : "border-[#dadce0] bg-white text-[#3c4043] hover:bg-[#f1f3f4]",
      )}
    >
      {label}
    </button>
  );
}

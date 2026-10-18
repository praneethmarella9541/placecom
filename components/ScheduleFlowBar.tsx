"use client";

import { useEffect, useState } from "react";
import { CalendarClock, ChevronDown, Clock, MailCheck, Plus, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { GmailDatePicker } from "@/components/GmailDatePicker";
import { Toggle, Select } from "@/components/SettingsControls";
import { isoDateLocal } from "@/lib/gmail-search-query";
import {
  MAX_FOLLOW_UPS,
  followUpDelayLabel,
  scheduleSummary,
  type ScheduleFlowState,
} from "@/lib/schedule-flow";

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

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

function hourLabel(value: string): string {
  const h = Number(value.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;
}


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
  // One pill's panel is open at a time, as with the delays in the Sequences editor.
  const [openPanel, setOpenPanel] = useState<"start" | "window" | "behaviour" | null>(null);
  const togglePanel = (p: "start" | "window" | "behaviour") => setOpenPanel((cur) => (cur === p ? null : p));
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
  const startSummary = scheduleSummary(flow).split(" · ")[0];
  const windowSummary = `${flow.businessDaysOnly ? "Weekdays" : "Every day"}, ${hourLabel(flow.windowStart)}–${hourLabel(flow.windowEnd)}`;
  const behaviourSummary = flow.exitOnReply ? "Stops on reply" : "Keeps going after a reply";
  const hourOptions = HOURS.map((h) => ({ value: h, label: hourLabel(h) }));

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

      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-3" data-testid="schedule-summary">
        <SettingPill
          icon={Clock}
          label="Starts"
          value={startSummary.replace(/^Starts /, "")}
          open={openPanel === "start"}
          onClick={() => togglePanel("start")}
        />
        <SettingPill
          icon={Timer}
          label="Sends"
          value={windowSummary}
          open={openPanel === "window"}
          onClick={() => togglePanel("window")}
        />
        <SettingPill
          icon={MailCheck}
          label="Replies"
          value={behaviourSummary.replace(/^Stops on reply$/, "Stop the flow").replace(/^Keeps going after a reply$/, "Keep going")}
          open={openPanel === "behaviour"}
          onClick={() => togglePanel("behaviour")}
        />
      </div>

      {openPanel === "start" && (
        <div className="space-y-3 border-t border-[#f1f3f4] bg-white px-3 py-4">
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
                onChange({ startMode: "later", startLocal: flow.startLocal || presets.tomorrow });
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
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Emails only go out inside the send window, so a start outside it moves to the next opening.
          </p>
        </div>
      )}

      {openPanel === "window" && (
        <div className="space-y-4 border-t border-[#f1f3f4] bg-white px-3 py-4">
          <div>
            <p className="text-[13px] font-medium text-[var(--color-text)]">Sending window</p>
            <p className="mb-2 mt-0.5 text-[12px] text-[var(--color-text-muted)]">
              Emails only go out inside this window.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                testId="schedule-window-start"
                value={flow.windowStart}
                options={hourOptions}
                disabled={disabled}
                onChange={(v) => onChange({ windowStart: v })}
              />
              <span className="text-[13px] text-[var(--color-text-faint)]">–</span>
              <Select
                testId="schedule-window-end"
                value={flow.windowEnd}
                options={hourOptions}
                disabled={disabled}
                onChange={(v) => onChange({ windowEnd: v })}
              />
            </div>
          </div>
          <Toggle
            testId="schedule-business-days"
            label="Business days only"
            hint="Skip weekends. Waits between follow-ups are then counted in business days too."
            checked={flow.businessDaysOnly}
            disabled={disabled}
            onChange={(v) => onChange({ businessDaysOnly: v })}
          />
        </div>
      )}

      {openPanel === "behaviour" && (
        <div className="space-y-4 border-t border-[#f1f3f4] bg-white px-3 py-4">
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

function SettingPill({
  icon: Icon,
  label,
  value,
  open,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-colors",
        open
          ? "border-[var(--color-copper)] bg-[var(--color-copper-tint)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-offset)]",
      )}
    >
      <Icon
        className={cn("h-3.5 w-3.5 shrink-0", open ? "text-[var(--color-copper)]" : "text-[var(--color-text-muted)]")}
        strokeWidth={2}
      />
      <span className="min-w-0 truncate text-[var(--color-text-muted)]">
        {label} <b className="font-semibold text-[var(--color-text)]">{value}</b>
      </span>
      <ChevronDown
        className={cn("h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] transition-transform", open && "rotate-180")}
      />
    </button>
  );
}

const timeFieldClass =
  "h-10 w-14 rounded-xl border border-transparent bg-[var(--color-surface-2)] px-2 text-center text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-copper)] disabled:opacity-50";

/**
 * Any time, typed: hour and minute fields plus an AM/PM switch. Text is committed when a field is
 * left (or Enter), so a half-typed "1" on the way to "11" never lands as a start time.
 */
function TimeFields({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const h24 = Number(value.slice(0, 2)) || 0;
  const pm = h24 >= 12;
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const minute = value.slice(3, 5) || "00";
  const [hourText, setHourText] = useState(String(hour12));
  const [minuteText, setMinuteText] = useState(minute);
  useEffect(() => setHourText(String(hour12)), [hour12]);
  useEffect(() => setMinuteText(minute), [minute]);

  const emit = (h: number, m: number, isPm: boolean) =>
    onChange(`${String((h % 12) + (isPm ? 12 : 0)).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  const commitHour = () => {
    const n = Math.min(12, Math.max(1, Math.round(Number(hourText)) || hour12));
    setHourText(String(n));
    emit(n, Number(minute), pm);
  };
  const commitMinute = () => {
    const n = Math.min(59, Math.max(0, Math.round(Number(minuteText)) || 0));
    setMinuteText(String(n).padStart(2, "0"));
    emit(hour12, n, pm);
  };
  const enterToCommit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        inputMode="numeric"
        maxLength={2}
        value={hourText}
        disabled={disabled}
        onChange={(e) => setHourText(e.target.value.replace(/\D/g, ""))}
        onFocus={(e) => e.target.select()}
        onBlur={commitHour}
        onKeyDown={enterToCommit}
        className={timeFieldClass}
        aria-label="Start hour"
      />
      <span className="text-[13px] text-[var(--color-text-faint)]">:</span>
      <input
        inputMode="numeric"
        maxLength={2}
        value={minuteText}
        disabled={disabled}
        onChange={(e) => setMinuteText(e.target.value.replace(/\D/g, ""))}
        onFocus={(e) => e.target.select()}
        onBlur={commitMinute}
        onKeyDown={enterToCommit}
        className={timeFieldClass}
        aria-label="Start minute"
      />
      <div className="ml-1 flex rounded-xl bg-[var(--color-surface-2)] p-0.5" role="radiogroup" aria-label="AM or PM">
        {[false, true].map((isPm) => (
          <button
            key={String(isPm)}
            type="button"
            role="radio"
            aria-checked={pm === isPm}
            disabled={disabled}
            onClick={() => emit(hour12, Number(minute), isPm)}
            className={cn(
              "h-9 rounded-[10px] px-3 text-[13px] font-medium transition-colors disabled:opacity-50",
              pm === isPm
                ? "bg-[var(--color-surface)] text-[var(--color-copper)] shadow-sm"
                : "text-[var(--color-text-muted)]",
            )}
          >
            {isPm ? "PM" : "AM"}
          </button>
        ))}
      </div>
    </div>
  );
}

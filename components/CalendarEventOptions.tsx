"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Paperclip, Plus, X } from "lucide-react";
import CalendarDrivePicker from "@/components/CalendarDrivePicker";
import {
  MAX_ATTACHMENTS,
  MAX_REMINDERS,
  reminderLabel,
  type EventOptions,
  type ReminderMethod,
  type Transparency,
  type Visibility,
} from "@/lib/calendar-extras";
import { listTimeZones, zoneOffsetLabel } from "@/lib/calendar-time";

type Props = {
  value: EventOptions;
  onChange: (next: EventOptions) => void;
  /** Whether the event has times (a time zone only matters then). */
  timed: boolean;
  /** Drive attach (picker) needs the Drive module. */
  driveEnabled: boolean;
  /** Guest permissions only mean something with guests. */
  hasGuests?: boolean;
};

const REMINDER_CHOICES = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080];

const VISIBILITY_LABELS: Record<Visibility, string> = {
  default: "Default visibility",
  public: "Public",
  private: "Private",
  confidential: "Confidential",
};

function fileName(url: string): string {
  return url.replace(/^https?:\/\//, "").slice(0, 40);
}

/** Time zone, reminders, guest permissions, visibility, busy/free and Drive attachments for an event. */
export default function CalendarEventOptions({ value, onChange, timed, driveEnabled, hasGuests = true }: Props) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const set = (patch: Partial<EventOptions>) => onChange({ ...value, ...patch });
  const zones = useMemo(() => listTimeZones([value.timeZone]), [value.timeZone]);

  function setReminder(i: number, patch: Partial<{ method: ReminderMethod; minutes: number }>) {
    set({ reminders: value.reminders.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  }

  function attach(file: { fileUrl: string; title?: string; mimeType?: string; fileId?: string }) {
    if (value.attachments.length >= MAX_ATTACHMENTS || value.attachments.some((a) => a.fileUrl === file.fileUrl)) return;
    set({ attachments: [...value.attachments, file] });
  }

  function attachLink() {
    const raw = link.trim();
    let ok = false;
    try {
      const u = new URL(raw);
      ok = u.protocol === "https:" && (u.hostname === "drive.google.com" || u.hostname === "docs.google.com");
    } catch {
      /* not a URL */
    }
    if (!ok) {
      setLinkError("Paste a Google Drive or Docs link.");
      return;
    }
    setLinkError(null);
    attach({ fileUrl: raw });
    setLink("");
  }

  const customised =
    value.customReminders ||
    value.visibility !== "default" ||
    value.transparency !== "opaque" ||
    value.guestsCanModify ||
    value.guestsCanInviteOthers ||
    !value.guestsCanSeeOtherGuests ||
    value.attachments.length > 0;

  const label = "mb-1 block text-[11px] font-medium text-[var(--color-text-faint)]";

  return (
    <div className="rounded-lg border border-[var(--color-border)]">
      <button
        type="button"
        data-testid="calendar-more-options"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-[var(--color-text)]"
      >
        <span>
          More options
          {!open && customised ? <span className="ml-2 text-xs font-normal text-[var(--color-copper)]">customised</span> : null}
        </span>
        <ChevronDown className={`h-4 w-4 text-[var(--color-text-faint)] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>

      {open ? (
        <div className="space-y-4 border-t border-[var(--color-border)] p-3">
          {timed ? (
            <label className="block">
              <span className={label}>Time zone</span>
              <select
                data-testid="calendar-timezone-select"
                value={value.timeZone}
                onChange={(e) => set({ timeZone: e.target.value })}
                className="input-field"
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    ({zoneOffsetLabel(z)}) {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] text-[var(--color-text-faint)]">
                The start and end times above are in this zone.
              </span>
            </label>
          ) : null}

          <div>
            <span className={label}>Reminders</span>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reminders-mode"
                  checked={!value.customReminders}
                  onChange={() => set({ customReminders: false })}
                />
                Calendar default
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="reminders-mode"
                  data-testid="calendar-custom-reminders"
                  checked={value.customReminders}
                  onChange={() => set({ customReminders: true, reminders: value.reminders.length ? value.reminders : [{ method: "popup", minutes: 10 }] })}
                />
                Custom
              </label>
              {value.customReminders ? (
                <div className="space-y-2 pl-6">
                  {value.reminders.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <select
                        value={r.method}
                        onChange={(e) => setReminder(i, { method: e.target.value as ReminderMethod })}
                        className="input-field !w-auto"
                        aria-label="Reminder type"
                      >
                        <option value="popup">Notification</option>
                        <option value="email">Email</option>
                      </select>
                      <select
                        value={r.minutes}
                        onChange={(e) => setReminder(i, { minutes: Number(e.target.value) })}
                        className="input-field !w-auto"
                        aria-label="Reminder time"
                      >
                        {(REMINDER_CHOICES.includes(r.minutes) ? REMINDER_CHOICES : [...REMINDER_CHOICES, r.minutes].sort((a, b) => a - b)).map((m) => (
                          <option key={m} value={m}>
                            {reminderLabel(m)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => set({ reminders: value.reminders.filter((_, j) => j !== i) })}
                        className="btn-ghost p-1.5"
                        aria-label="Remove reminder"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {value.reminders.length < MAX_REMINDERS ? (
                    <button
                      type="button"
                      onClick={() => set({ reminders: [...value.reminders, { method: "popup", minutes: 30 }] })}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-copper)] hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden /> Add reminder
                    </button>
                  ) : null}
                  {value.reminders.length === 0 ? (
                    <p className="text-[11px] text-[var(--color-text-faint)]">No reminders for this event.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}>Show me as</span>
              <select
                data-testid="calendar-transparency-select"
                value={value.transparency}
                onChange={(e) => set({ transparency: e.target.value as Transparency })}
                className="input-field"
              >
                <option value="opaque">Busy</option>
                <option value="transparent">Free</option>
              </select>
            </label>
            <label className="block">
              <span className={label}>Visibility</span>
              <select
                data-testid="calendar-visibility-select"
                value={value.visibility}
                onChange={(e) => set({ visibility: e.target.value as Visibility })}
                className="input-field"
              >
                {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {hasGuests ? (
            <div>
              <span className={label}>Guest permissions</span>
              <div className="space-y-1.5 text-sm">
                {(
                  [
                    ["guestsCanModify", "Modify event"],
                    ["guestsCanInviteOthers", "Invite others"],
                    ["guestsCanSeeOtherGuests", "See guest list"],
                  ] as const
                ).map(([key, text]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={value[key]}
                      onChange={(e) => set({ [key]: e.target.checked } as Partial<EventOptions>)}
                      className="h-4 w-4 accent-[var(--color-copper)]"
                    />
                    {text}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <span className={label}>Attachments</span>
            {value.attachments.length > 0 ? (
              <ul className="mb-2 space-y-1">
                {value.attachments.map((a) => (
                  <li key={a.fileUrl} className="flex items-center gap-2 rounded-md bg-[var(--color-surface-offset)] px-2 py-1.5 text-sm">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-faint)]" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{a.title || fileName(a.fileUrl)}</span>
                    <button
                      type="button"
                      onClick={() => set({ attachments: value.attachments.filter((x) => x.fileUrl !== a.fileUrl) })}
                      className="btn-ghost p-1"
                      aria-label={`Remove ${a.title || "attachment"}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {driveEnabled ? (
              picking ? (
                <CalendarDrivePicker
                  taken={value.attachments.map((a) => a.fileUrl)}
                  onPick={attach}
                  onClose={() => setPicking(false)}
                />
              ) : (
                <button
                  type="button"
                  data-testid="calendar-attach-drive"
                  onClick={() => setPicking(true)}
                  disabled={value.attachments.length >= MAX_ATTACHMENTS}
                  className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                >
                  <Paperclip className="h-3.5 w-3.5" aria-hidden /> Attach from Drive
                </button>
              )
            ) : null}
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    attachLink();
                  }
                }}
                placeholder="Or paste a Drive / Docs link"
                className="input-field"
              />
              <button type="button" onClick={attachLink} disabled={!link.trim()} className="btn-ghost shrink-0 px-3 text-xs">
                Add
              </button>
            </div>
            {linkError ? <p className="mt-1 text-xs text-red-600">{linkError}</p> : null}
            <p className="mt-1 text-[11px] text-[var(--color-text-faint)]">Guests can open attached files only if they have access to them in Drive.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

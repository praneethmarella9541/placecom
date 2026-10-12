"use client";

import { useState } from "react";
import type { SeriesScope } from "@/lib/google-calendar";

type Props = {
  title: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  /** Extra controls (notify choice, note …) shown under the scope choice. */
  children?: React.ReactNode;
  onConfirm: (scope: SeriesScope) => void;
  onCancel: () => void;
};

const CHOICES: { value: SeriesScope; label: string }[] = [
  { value: "this", label: "This event" },
  { value: "following", label: "This and following events" },
  { value: "all", label: "All events" },
];

/** The three-way choice on its own, for dialogs that add more controls around it. */
export function ScopeChoice({ value, onChange, name = "series-scope" }: { value: SeriesScope; onChange: (s: SeriesScope) => void; name?: string }) {
  return (
    <div className="space-y-2" role="radiogroup" aria-label="Which events">
      {CHOICES.map((c) => (
        <label key={c.value} className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--color-text)]">
          <input type="radio" name={name} checked={value === c.value} onChange={() => onChange(c.value)} />
          {c.label}
        </label>
      ))}
    </div>
  );
}

/** Google Calendar's "this event / this and following / all events" question for a repeating event. */
export default function CalendarScopeDialog({ title, confirmLabel, destructive, busy, children, onConfirm, onCancel }: Props) {
  const [scope, setScope] = useState<SeriesScope>("this");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in">
      <div data-testid="calendar-scope-dialog" className="card w-full max-w-sm max-h-[90vh] overflow-y-auto animate-scale-in">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--color-text)]">{title}</h3>
        </div>
        <div className="space-y-3 px-5 py-4">
          <ScopeChoice value={scope} onChange={setScope} />
          {children}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            data-testid="calendar-scope-confirm"
            onClick={() => onConfirm(scope)}
            disabled={busy}
            className={
              destructive
                ? "rounded-[var(--radius-md)] bg-[var(--color-danger)] px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                : "btn-primary"
            }
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

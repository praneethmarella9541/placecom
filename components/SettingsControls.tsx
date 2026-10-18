"use client";

import { titleCase } from "@/lib/title-case";

/**
 * The settings vocabulary shared by the Sequences editor and the composer's Scheduling panel:
 * a titled card (Section), a label + hint row (Row), a switch (Toggle) and a soft-filled select.
 */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="mb-4 text-[14px] font-semibold text-[var(--color-text)]">
        {titleCase(title)}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[13px] font-medium text-[var(--color-text)]">{titleCase(label)}</p>
      {hint ? (
        <p className="mb-2 mt-0.5 text-[12px] text-[var(--color-text-muted)]">{hint}</p>
      ) : (
        <div className="mb-2" />
      )}
      {children}
    </div>
  );
}

export function Toggle({
  testId,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  testId: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-[var(--color-text)]">{titleCase(label)}</p>
        {hint ? <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">{hint}</p> : null}
      </div>
      {/* inline-flex + items-center, and the knob laid out as a normal flex
          child moved by `transform` alone — not `position: absolute` with no
          `left` set, which left its horizontal position resting on the
          browser's "static position" fallback instead of an explicit value
          and rendered the knob detached from the track. Matches the proven
          Toggle in ConnectionStrengthSettingsModal.tsx. */}
      <button
        data-testid={testId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          checked ? "bg-[var(--color-copper)]" : "bg-[var(--color-border-strong)]"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export function Select({
  testId,
  value,
  options,
  disabled,
  onChange,
}: {
  testId: string;
  value: string;
  /** Plain strings, or { value, label } when the shown text differs from the stored value. */
  options: (string | { value: string; label: string })[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select
      data-testid={testId}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 rounded-xl border border-transparent bg-[var(--color-surface-2)] px-3 text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-copper)] disabled:opacity-50"
    >
      {options.some((o) => (typeof o === "string" ? o : o.value) === value) ? null : <option value={value}>{value}</option>}
      {options.map((option) => {
        const opt = typeof option === "string" ? { value: option, label: option } : option;
        return (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        );
      })}
    </select>
  );
}

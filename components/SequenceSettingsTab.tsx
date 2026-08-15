"use client";

import { titleCase } from "@/lib/title-case";
import type { Sequence } from "@/lib/sequence-types";

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
  sequence: Sequence;
  saving: boolean;
  onChange: (patch: Partial<Sequence>) => void;
};

export function SequenceSettingsTab({ sequence, saving, onChange }: Props) {
  return (
    <div className="space-y-5">
      <Section title="Delivery">
        <Row
          label="Sending window"
          hint="Emails only go out inside this window, in the timezone below."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Select
              testId="sequence-window-start"
              value={sequence.sendWindowStart}
              options={HOURS}
              disabled={saving}
              onChange={(v) => onChange({ sendWindowStart: v })}
            />
            <span className="text-[13px] text-[var(--color-text-faint)]">–</span>
            <Select
              testId="sequence-window-end"
              value={sequence.sendWindowEnd}
              options={HOURS}
              disabled={saving}
              onChange={(v) => onChange({ sendWindowEnd: v })}
            />
            <Select
              testId="sequence-timezone"
              value={sequence.timezone}
              options={TIMEZONES}
              disabled={saving}
              onChange={(v) => onChange({ timezone: v })}
            />
          </div>
        </Row>

        <Toggle
          testId="sequence-business-days"
          label="Business days only"
          hint="Skip weekends. Step delays are then counted in business days too."
          checked={sequence.businessDaysOnly}
          disabled={saving}
          onChange={(v) => onChange({ businessDaysOnly: v })}
        />

        <Row
          label="Daily send limit"
          hint="Caps how many emails this sequence sends per day. Gmail's quota is shared with the rest of the app."
        >
          <input
            data-testid="sequence-daily-limit"
            type="number"
            min={1}
            max={2000}
            value={sequence.dailySendLimit}
            disabled={saving}
            onChange={(e) => onChange({ dailySendLimit: Number(e.target.value) })}
            className="h-10 w-28 rounded-xl border border-transparent bg-[var(--color-surface-2)] px-3 text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-copper)]"
          />
        </Row>
      </Section>

      <Section title="Email">
        <Toggle
          testId="sequence-thread-emails"
          label="Thread emails"
          hint="Send each follow-up as a reply on the same conversation, keeping the first subject."
          checked={sequence.threadEmails}
          disabled={saving}
          onChange={(v) => onChange({ threadEmails: v })}
        />
        <Toggle
          testId="sequence-include-signature"
          label="Include signature"
          hint="Append the signature below to every email in this sequence."
          checked={sequence.includeSignature}
          disabled={saving}
          onChange={(v) => onChange({ includeSignature: v })}
        />
        {sequence.includeSignature ? (
          <Row label="Signature" hint="Basic HTML is allowed.">
            <textarea
              data-testid="sequence-signature"
              value={sequence.signatureHtml ?? ""}
              disabled={saving}
              onChange={(e) => onChange({ signatureHtml: e.target.value })}
              placeholder="<p>Best,<br>Placement Team</p>"
              className="min-h-[90px] w-full rounded-xl border border-transparent bg-[var(--color-surface-2)] px-4 py-3 font-mono text-[12.5px] text-[var(--color-text)] outline-none focus:border-[var(--color-copper)] focus:bg-[var(--color-surface)]"
            />
          </Row>
        ) : null}
        <Toggle
          testId="sequence-track-opens"
          label="Track opens"
          hint="Adds a tracking pixel so you can see who opened each email."
          checked={sequence.trackOpens}
          disabled={saving}
          onChange={(v) => onChange({ trackOpens: v })}
        />
      </Section>

      <Section title="Exit criteria">
        <Toggle
          testId="sequence-exit-on-reply"
          label="Stop when someone replies"
          hint="As soon as a reply lands on the thread, that recipient gets no further emails."
          checked={sequence.exitOnReply}
          disabled={saving}
          onChange={(v) => onChange({ exitOnReply: v })}
        />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="mb-4 text-[14px] font-semibold text-[var(--color-text)]">
        {titleCase(title)}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Row({
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

function Toggle({
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
      <button
        data-testid={testId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
          checked ? "bg-[var(--color-copper)]" : "bg-[var(--color-surface-2)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function Select({
  testId,
  value,
  options,
  disabled,
  onChange,
}: {
  testId: string;
  value: string;
  options: string[];
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
      {options.includes(value) ? null : <option value={value}>{value}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

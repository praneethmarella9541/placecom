"use client";

import { Row, Section, Select, Toggle } from "@/components/SettingsControls";
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
  /** A send scheduled from Compose: it has no time zone, daily limit, signature or open tracking to set. */
  scheduled?: boolean;
  saving: boolean;
  onChange: (patch: Partial<Sequence>) => void;
};

export function SequenceSettingsTab({ sequence, scheduled, saving, onChange }: Props) {
  return (
    <div className="space-y-5">
      {scheduled ? null : (
      <Section title="Delivery">
        <Row
          label="Sending window"
          hint={
            scheduled
              ? "Emails only go out inside this window."
              : "Emails only go out inside this window, in the timezone below."
          }
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
            {scheduled ? null : (
              <Select
                testId="sequence-timezone"
                value={sequence.timezone}
                options={TIMEZONES}
                disabled={saving}
                onChange={(v) => onChange({ timezone: v })}
              />
            )}
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

        {scheduled ? null : (
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
        )}
      </Section>
      )}

      <Section title="Email">
        <Toggle
          testId="sequence-thread-emails"
          label="Thread emails"
          hint="Send each follow-up as a reply on the same conversation, keeping the first subject."
          checked={sequence.threadEmails}
          disabled={saving}
          onChange={(v) => onChange({ threadEmails: v })}
        />
        {scheduled ? null : (
        <Toggle
          testId="sequence-include-signature"
          label="Include signature"
          hint="Append the signature below to every email in this sequence."
          checked={sequence.includeSignature}
          disabled={saving}
          onChange={(v) => onChange({ includeSignature: v })}
        />
        )}
        {!scheduled && sequence.includeSignature ? (
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
        {scheduled ? null : (
        <Toggle
          testId="sequence-track-opens"
          label="Track opens"
          hint="Adds a tracking pixel so you can see who opened each email."
          checked={sequence.trackOpens}
          disabled={saving}
          onChange={(v) => onChange({ trackOpens: v })}
        />
        )}
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

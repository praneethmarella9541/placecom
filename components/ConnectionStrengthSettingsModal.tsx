"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";
import type { ConnectionStrengthSettings } from "@/lib/email-connection-strength";
import { CONNECTION_STRENGTH_DOT } from "@/lib/connection-strength-ui";
import { IconX } from "@/components/Icons";

type SettingsResponse = { settings: ConnectionStrengthSettings; isDefault: boolean; error?: string };
type InitialSettings = { settings: ConnectionStrengthSettings; isDefault: boolean } | null | undefined;
type Tab = "Good" | "Weak" | "No communication";
const TABS: Tab[] = ["Good", "Weak", "No communication"];

/**
 * Personal thresholds for the auto-synced-contacts "connection strength"
 * bucket (Good/Weak/Very weak/No communication) — see
 * lib/email-connection-strength.ts. Deliberately per-user, not team-shared:
 * two teammates can calibrate this differently and both see it applied live,
 * the next time either of them loads the Contacts page (no sync needed —
 * the underlying dates/counts are unaffected by this).
 */
export function ConnectionStrengthSettingsModal({
  initial,
  onClose,
  onSaved,
}: {
  /** Prefetched by the caller (see SyncedContactsSection) so opening this is instant; falls back to fetching itself if omitted/not ready yet. */
  initial?: InitialSettings;
  onClose: () => void;
  onSaved: (next: { settings: ConnectionStrengthSettings; isDefault: boolean }) => void;
}) {
  const [tab, setTab] = useState<Tab>("Good");
  const [loading, setLoading] = useState(!initial);
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? true);
  const [form, setForm] = useState<ConnectionStrengthSettings | null>(initial?.settings ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/user-settings/connection-strength");
        const data = (await res.json()) as SettingsResponse;
        if (!res.ok) throw new Error(data.error || "Failed to load settings");
        if (!cancelled) {
          setForm(data.settings);
          setIsDefault(data.isDefault);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user-settings/connection-strength", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json()) as SettingsResponse;
      if (!res.ok) throw new Error(data.error || "Failed to save settings");
      onSaved({ settings: data.settings, isDefault: data.isDefault });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setBusy(false);
    }
  }

  async function resetToDefault() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/user-settings/connection-strength", { method: "DELETE" });
      const data = (await res.json()) as SettingsResponse;
      if (!res.ok) throw new Error(data.error || "Failed to reset settings");
      setForm(data.settings);
      setIsDefault(true);
      onSaved({ settings: data.settings, isDefault: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset settings");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strength-settings-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-6 pt-5 pb-4">
          <div className="min-w-0">
            <h2
              id="strength-settings-title"
              className="font-display text-lg font-bold text-[var(--color-text)]"
            >
              {titleCase("Connection strength")}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
              How your synced contacts get sorted into strength buckets. Only affects your view.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost -mr-1.5 -mt-0.5 shrink-0 p-1.5"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        {loading || !form ? (
          <div className="px-6 pb-6">
            <div className="h-9 animate-pulse rounded-lg bg-[var(--color-surface-offset)]/60" />
            <div className="mt-4 space-y-3">
              <div className="h-14 animate-pulse rounded-xl bg-[var(--color-surface-offset)]/40" />
              <div className="h-14 animate-pulse rounded-xl bg-[var(--color-surface-offset)]/40" />
              <div className="h-16 animate-pulse rounded-xl bg-[var(--color-surface-offset)]/40" />
            </div>
          </div>
        ) : (
          <>
            <div className="shrink-0 px-6">
              <div className="flex gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)]/70 p-1.5">
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[12.5px] font-semibold transition-colors",
                      tab === t
                        ? "border-[var(--color-copper)]/40 bg-[var(--color-copper-tint)] text-[var(--color-copper)] shadow-sm"
                        : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]/60 hover:text-[var(--color-text)]"
                    )}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT[t]}`}
                    />
                    {t === "No communication" ? "None" : t}
                  </button>
                ))}
              </div>
            </div>

            <form
              id="strength-settings-form"
              className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5"
              onSubmit={(e) => void save(e)}
            >
              {tab === "Good" && (
                <TierPanel
                  tier="Good"
                  blurb="A contact is Good when every check below passes."
                  recencyDays={form.goodRecencyDays}
                  onRecencyDaysChange={(v) => setForm({ ...form, goodRecencyDays: v })}
                  minMessages={form.goodMinMessages}
                  onMinMessagesChange={(v) => setForm({ ...form, goodMinMessages: v })}
                  windowDays={form.goodWindowDays}
                  onWindowDaysChange={(v) => setForm({ ...form, goodWindowDays: v })}
                  requireOutbound={form.requireOutboundForGood}
                  onRequireOutboundChange={(v) => setForm({ ...form, requireOutboundForGood: v })}
                />
              )}
              {tab === "Weak" && (
                <TierPanel
                  tier="Weak"
                  blurb="Weak catches contacts that fall just short of Good."
                  recencyDays={form.weakRecencyDays}
                  onRecencyDaysChange={(v) => setForm({ ...form, weakRecencyDays: v })}
                  minMessages={form.weakMinMessages}
                  onMinMessagesChange={(v) => setForm({ ...form, weakMinMessages: v })}
                  windowDays={form.weakWindowDays}
                  onWindowDaysChange={(v) => setForm({ ...form, weakWindowDays: v })}
                  requireOutbound={form.requireOutboundForWeak}
                  onRequireOutboundChange={(v) => setForm({ ...form, requireOutboundForWeak: v })}
                  recencyMin={form.goodRecencyDays}
                  recencyMinHint={`at least the Good window (${form.goodRecencyDays})`}
                />
              )}
              {tab === "No communication" && (
                <div className="space-y-4">
                  <PanelHeading
                    tier="No communication"
                    blurb="Contacts you have no real correspondence with."
                  />
                  <ToggleRow
                    label="Include cc-only contacts"
                    helper="People you were only ever cc'd alongside — never emailed to or from directly."
                    checked={form.treatCcOnlyAsNoCommunication}
                    onChange={(v) => setForm({ ...form, treatCcOnlyAsNoCommunication: v })}
                  />
                  <p className="text-[12px] leading-relaxed text-[var(--color-text-faint)]">
                    A contact with no synced messages at all always lands here, whatever this is set
                    to.
                  </p>
                </div>
              )}

              {error && (
                <p className="mt-4 rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">
                  {error}
                </p>
              )}
            </form>

            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface-offset)]/40 px-6 py-2.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT["Very weak"]}`} />
              <p className="text-[11.5px] leading-snug text-[var(--color-text-faint)]">
                <span className="font-semibold text-[var(--color-text-muted)]">Very weak</span> — has
                some history, but clears neither Good nor Weak.
              </p>
            </div>
          </>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-border)] px-6 py-3.5">
          <button
            type="button"
            className="text-[12.5px] font-medium text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline disabled:opacity-40 disabled:no-underline"
            onClick={() => void resetToDefault()}
            disabled={busy || isDefault || loading}
          >
            {isDefault ? titleCase("Using defaults") : titleCase("Reset to default")}
          </button>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost px-4" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              form="strength-settings-form"
              className="btn-primary-copper px-4"
              disabled={busy || loading}
            >
              {busy ? "Saving…" : titleCase("Save")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function PanelHeading({ tier, blurb }: { tier: Tab; blurb: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT[tier]}`} />
      <p className="text-[12.5px] leading-snug text-[var(--color-text-muted)]">{blurb}</p>
    </div>
  );
}

function TierPanel({
  tier,
  blurb,
  recencyDays,
  onRecencyDaysChange,
  minMessages,
  onMinMessagesChange,
  windowDays,
  onWindowDaysChange,
  requireOutbound,
  onRequireOutboundChange,
  recencyMin = 1,
  recencyMinHint,
}: {
  tier: "Good" | "Weak";
  blurb: string;
  recencyDays: number;
  onRecencyDaysChange: (v: number) => void;
  minMessages: number;
  onMinMessagesChange: (v: number) => void;
  windowDays: number;
  onWindowDaysChange: (v: number) => void;
  requireOutbound: boolean;
  onRequireOutboundChange: (v: boolean) => void;
  recencyMin?: number;
  recencyMinHint?: string;
}) {
  return (
    <div className="space-y-3">
      <PanelHeading tier={tier} blurb={blurb} />

      <Field
        label="Contacted recently"
        helper={
          recencyMinHint
            ? `Last message within this many days — ${recencyMinHint}.`
            : "Last message within this many days."
        }
      >
        <Stepper value={recencyDays} min={recencyMin} max={365} unit="days" onChange={onRecencyDaysChange} />
      </Field>

      <Field label="Enough back-and-forth" helper="Messages exchanged inside a recent window.">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[12.5px] text-[var(--color-text-muted)]">at least</span>
            <Stepper value={minMessages} min={1} max={99} unit="msgs" onChange={onMinMessagesChange} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[12.5px] text-[var(--color-text-muted)]">
              in the last
            </span>
            <Stepper value={windowDays} min={1} max={365} unit="days" onChange={onWindowDaysChange} />
          </div>
        </div>
      </Field>

      <ToggleRow
        label="Require a reply from you"
        helper={`Off: inbound-only threads can still count as ${tier}.`}
        checked={requireOutbound}
        onChange={onRequireOutboundChange}
      />
    </div>
  );
}

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)]/40 p-3.5">
      <p className="text-[13px] font-semibold text-[var(--color-text)]">{label}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-text-muted)]">{helper}</p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function Stepper({
  value,
  min,
  max,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  // Local text state so the field can be briefly empty/partial while typing;
  // the clamped number is committed on change (valid) and on blur.
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const next = clamp(Number(raw), min, max);
    onChange(next);
    setText(String(next));
  };

  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] focus-within:border-[var(--color-copper)] focus-within:ring-2 focus-within:ring-[var(--color-copper)]/20">
        <button
          type="button"
          aria-label="Decrease"
          disabled={atMin}
          onClick={() => onChange(clamp(value - 1, min, max))}
          className="flex h-8 w-8 items-center justify-center text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)]/60 hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-30"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 8h10" />
          </svg>
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={text}
          onFocus={(e) => {
            focused.current = true;
            e.target.select();
          }}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, "");
            setText(raw);
            if (raw !== "") {
              const n = Number(raw);
              if (n >= min && n <= max) onChange(n);
            }
          }}
          onBlur={(e) => {
            focused.current = false;
            commit(e.target.value);
          }}
          className="h-8 w-9 border-x border-[var(--color-border)] bg-transparent text-center text-[13px] font-semibold text-[var(--color-text)] outline-none"
        />
        <button
          type="button"
          aria-label="Increase"
          disabled={atMax}
          onClick={() => onChange(clamp(value + 1, min, max))}
          className="flex h-8 w-8 items-center justify-center text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)]/60 hover:text-[var(--color-text)] disabled:pointer-events-none disabled:opacity-30"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </span>
      {unit && <span className="text-[12.5px] text-[var(--color-text-muted)]">{unit}</span>}
    </span>
  );
}

function ToggleRow({
  label,
  helper,
  checked,
  onChange,
}: {
  label: string;
  helper: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)]/40 p-3.5 text-left transition-colors hover:border-[var(--color-border-strong)]"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[var(--color-text)]">{label}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-text-muted)]">{helper}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </button>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span
      role="switch"
      aria-checked={checked}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-[var(--color-copper)]" : "bg-[var(--color-border-strong)]"
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[19px]" : "translate-x-[3px]"
        )}
      />
    </span>
  );
}

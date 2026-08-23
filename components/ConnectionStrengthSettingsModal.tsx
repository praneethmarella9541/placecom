"use client";

import { useEffect, useState } from "react";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="strength-settings-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 p-6 pb-4">
          <h2 id="strength-settings-title" className="font-display text-lg font-bold text-[var(--color-text)]">
            {titleCase("Connection strength")}
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost shrink-0 p-1.5" aria-label="Close">
            <IconX className="h-4 w-4" />
          </button>
        </div>

        {loading || !form ? (
          <p className="px-6 pb-6 text-[13px] text-[var(--color-text-muted)]">{titleCase("Loading…")}</p>
        ) : (
          <>
            <div className="flex shrink-0 gap-1 px-6">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-[13px] font-semibold transition-colors",
                    tab === t
                      ? "border-[var(--color-copper)] text-[var(--color-text)]"
                      : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  )}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${CONNECTION_STRENGTH_DOT[t]}`} />
                  {t}
                </button>
              ))}
            </div>
            <div className="shrink-0 border-b border-[var(--color-border)]" />

            <form
              id="strength-settings-form"
              className="min-h-0 flex-1 overflow-y-auto p-6"
              onSubmit={(e) => void save(e)}
            >
              {tab === "Good" && (
                <TierPanel
                  tier="Good"
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
                  recencyDays={form.weakRecencyDays}
                  onRecencyDaysChange={(v) => setForm({ ...form, weakRecencyDays: v })}
                  minMessages={form.weakMinMessages}
                  onMinMessagesChange={(v) => setForm({ ...form, weakMinMessages: v })}
                  windowDays={form.weakWindowDays}
                  onWindowDaysChange={(v) => setForm({ ...form, weakWindowDays: v })}
                  requireOutbound={form.requireOutboundForWeak}
                  onRequireOutboundChange={(v) => setForm({ ...form, requireOutboundForWeak: v })}
                  minDays={form.goodRecencyDays}
                />
              )}
              {tab === "No communication" && (
                <ToggleRow
                  label="Treat cc-only as No communication"
                  helper="Only ever cc'd, never addressed directly."
                  checked={form.treatCcOnlyAsNoCommunication}
                  onChange={(v) => setForm({ ...form, treatCcOnlyAsNoCommunication: v })}
                />
              )}

              {error && <p className="mt-4 text-[13px] text-[var(--color-danger)]">{error}</p>}
            </form>

            <div className="shrink-0 border-t border-[var(--color-border)] px-6 py-2 text-[11px] text-[var(--color-text-faint)]">
              Very weak is everything else.
            </div>
          </>
        )}

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-border)] p-4">
          <button
            type="button"
            className="text-[13px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
            onClick={() => void resetToDefault()}
            disabled={busy || isDefault || loading}
          >
            {titleCase("Reset to default")}
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

function TierPanel({
  tier,
  recencyDays,
  onRecencyDaysChange,
  minMessages,
  onMinMessagesChange,
  windowDays,
  onWindowDaysChange,
  requireOutbound,
  onRequireOutboundChange,
  minDays,
}: {
  tier: "Good" | "Weak";
  recencyDays: number;
  onRecencyDaysChange: (v: number) => void;
  minMessages: number;
  onMinMessagesChange: (v: number) => void;
  windowDays: number;
  onWindowDaysChange: (v: number) => void;
  requireOutbound: boolean;
  onRequireOutboundChange: (v: boolean) => void;
  minDays?: number;
}) {
  return (
    <div className="space-y-5">
      <Sentence>
        Active within <InlineNumber value={recencyDays} min={minDays ?? 1} onChange={onRecencyDaysChange} /> days
      </Sentence>
      <Sentence>
        At least <InlineNumber value={minMessages} min={1} onChange={onMinMessagesChange} /> msgs in{" "}
        <InlineNumber value={windowDays} min={1} onChange={onWindowDaysChange} /> days
      </Sentence>

      <ToggleRow
        label="Require a reply from you"
        helper={`Otherwise one-way mail can still count as ${tier}.`}
        checked={requireOutbound}
        onChange={onRequireOutboundChange}
      />
    </div>
  );
}

function Sentence({ children }: { children: React.ReactNode }) {
  return <p className="text-[14px] leading-[2.1] text-[var(--color-text)]">{children}</p>;
}

function InlineNumber({
  value,
  min,
  onChange,
}: {
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="mx-0.5 inline-block w-14 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-1.5 py-0.5 text-center text-[14px] font-semibold text-[var(--color-text)] outline-none focus:border-[var(--color-copper)] focus:ring-2 focus:ring-[var(--color-copper)]/20"
    />
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
    <div className="flex items-start justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-offset)]/50 p-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-[var(--color-text)]">{label}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-text-muted)]">{helper}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-[var(--color-copper)]" : "bg-[var(--color-border-strong)]"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[19px]" : "translate-x-1"
        )}
      />
    </button>
  );
}

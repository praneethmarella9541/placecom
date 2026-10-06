"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { AdminToast, toastVariantForMessage, type AdminToastState } from "@/components/AdminToast";
import { FEATURE_LABELS, type FeatureKey } from "@/lib/feature-access";
import {
  MODULE_DESCRIPTIONS,
  MODULE_GROUPS,
  isGroupEnabled,
  isModuleEnabled,
  normalizeModuleConfig,
  type ModuleConfig,
  type ModuleGroupKey,
} from "@/lib/module-config";
import { refreshMeMailbox } from "@/lib/use-me-mailbox";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";

const EMPTY: ModuleConfig = { disabledGroups: [], disabledModules: [], allowDelete: false };

function sameConfig(a: ModuleConfig, b: ModuleConfig): boolean {
  const norm = (c: ModuleConfig) =>
    JSON.stringify({
      g: [...c.disabledGroups].sort(),
      m: [...c.disabledModules].sort(),
      d: c.allowDelete,
    });
  return norm(a) === norm(b);
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  size = "md",
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={`toggle-${label.toLowerCase().replace(/\s+/g, "-")}`}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        "relative shrink-0 rounded-full transition-colors",
        size === "md" ? "h-[22px] w-[38px]" : "h-[18px] w-[32px]",
        checked ? "bg-[var(--color-copper)]" : "bg-[var(--color-border)]",
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow-sm transition-[left]",
          size === "md" ? "h-[16px] w-[16px]" : "h-[13px] w-[13px]",
          checked
            ? size === "md"
              ? "left-[19px]"
              : "left-[16px]"
            : "left-[3px]",
        )}
      />
    </button>
  );
}

export default function ConfigsPage() {
  const [saved, setSaved] = useState<ModuleConfig>(EMPTY);
  const [draft, setDraft] = useState<ModuleConfig>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [toast, setToast] = useState<AdminToastState>(null);

  const showToast = useCallback((message: string, variant?: "info" | "success" | "error") => {
    setToast({ message, variant: variant ?? toastVariantForMessage(message) });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/configs/modules", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          config?: unknown;
          updatedAt?: string | null;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(json.error || "Could not load platform configuration.");
          return;
        }
        const config = normalizeModuleConfig(json.config);
        setSaved(config);
        setDraft(config);
        setUpdatedAt(json.updatedAt ?? null);
      } catch {
        if (!cancelled) setLoadError("Could not load platform configuration.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = useMemo(() => !sameConfig(saved, draft), [saved, draft]);

  const toggleGroup = useCallback((group: ModuleGroupKey) => {
    setDraft((prev) => {
      const off = prev.disabledGroups.includes(group);
      return {
        ...prev,
        disabledGroups: off
          ? prev.disabledGroups.filter((g) => g !== group)
          : [...prev.disabledGroups, group],
      };
    });
  }, []);

  const toggleModule = useCallback((feature: FeatureKey) => {
    setDraft((prev) => {
      const off = prev.disabledModules.includes(feature);
      return {
        ...prev,
        disabledModules: off
          ? prev.disabledModules.filter((m) => m !== feature)
          : [...prev.disabledModules, feature],
      };
    });
  }, []);

  const toggleAllowDelete = useCallback(() => {
    setDraft((prev) => ({ ...prev, allowDelete: !prev.allowDelete }));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/configs/modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json().catch(() => ({}))) as { config?: unknown; error?: string };
      if (!res.ok) {
        showToast(json.error || "Could not save configuration.", "error");
        return;
      }
      const config = normalizeModuleConfig(json.config);
      setSaved(config);
      setDraft(config);
      setUpdatedAt(new Date().toISOString());
      // Pull the new module set into this tab's cached session immediately so
      // the sidebar reflects the change without a reload.
      void refreshMeMailbox();
      showToast("Module configuration saved.", "success");
    } catch {
      showToast("Could not save configuration.", "error");
    } finally {
      setSaving(false);
    }
  }

  /** Features whose effective on/off state differs from what is saved. */
  const changed = useMemo(() => {
    const out = new Set<FeatureKey>();
    for (const group of MODULE_GROUPS) {
      for (const m of group.modules) {
        if (isModuleEnabled(draft, m) !== isModuleEnabled(saved, m)) out.add(m);
      }
    }
    return out;
  }, [draft, saved]);

  const offCount = useMemo(
    () =>
      MODULE_GROUPS.reduce(
        (n, g) => n + g.modules.filter((m) => !isModuleEnabled(draft, m)).length,
        0,
      ),
    [draft],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-text)]">
          {titleCase("Platform configuration")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {titleCase(
            "Which modules exist on this deployment. Switching one off removes its nav entry, its pages, its data routes, and every link into it from other modules — for everyone, including admins.",
          )}
        </p>
      </div>

      {loadError ? (
        <div className="surface-card flex items-start gap-3 p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-danger)]" />
          <div>
            <p className="text-[13px] font-semibold text-[var(--color-text)]">
              {titleCase("Configuration unavailable")}
            </p>
            <p className="mt-1 text-[12.5px] text-[var(--color-text-muted)]">{loadError}</p>
          </div>
        </div>
      ) : loading ? (
        <div className="surface-card flex items-center gap-2.5 p-5 text-[13px] text-[var(--color-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          {titleCase("Loading configuration…")}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {MODULE_GROUPS.map((group) => {
              const groupOn = isGroupEnabled(draft, group.key);
              return (
                <div key={group.key} className="surface-card overflow-hidden">
                  <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5">
                    <div className="min-w-0">
                      <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">
                        {titleCase(group.label)}
                      </h2>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
                        {group.description}
                      </p>
                    </div>
                    <Toggle
                      checked={groupOn}
                      onChange={() => toggleGroup(group.key)}
                      label={`${group.label} group`}
                    />
                  </div>

                  <div className={cn("divide-y divide-[var(--color-border)]", !groupOn && "opacity-50")}>
                    {group.modules.map((feature) => {
                      const moduleOn = !draft.disabledModules.includes(feature);
                      return (
                        <div
                          key={feature}
                          className="flex items-center justify-between gap-4 px-5 py-3"
                        >
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-semibold text-[var(--color-text)]">
                              {titleCase(FEATURE_LABELS[feature])}
                            </p>
                            <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-text-muted)]">
                              {MODULE_DESCRIPTIONS[feature]}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2.5">
                            {changed.has(feature) && (
                              <span className="rounded-full bg-[var(--color-copper)]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-copper)]">
                                {isModuleEnabled(draft, feature) ? "On" : "Off"}
                              </span>
                            )}
                            <Toggle
                              size="sm"
                              checked={moduleOn && groupOn}
                              disabled={!groupOn}
                              onChange={() => toggleModule(feature)}
                              label={FEATURE_LABELS[feature]}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="surface-card flex items-start justify-between gap-4 p-5">
            <div className="min-w-0">
              <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">
                {titleCase("Deleting")}
              </h2>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--color-text-muted)]">
                {titleCase(
                  "Lets people delete mail, Drive files and folders, Docs, Sheets, and Forms. Off by default. Items go to Google's trash and can be restored there; only Mail's Delete forever, inside Trash, is permanent.",
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {draft.allowDelete !== saved.allowDelete && (
                <span className="rounded-full bg-[var(--color-copper)]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--color-copper)]">
                  {draft.allowDelete ? "On" : "Off"}
                </span>
              )}
              <Toggle
                checked={draft.allowDelete}
                onChange={toggleAllowDelete}
                label="Allow delete"
              />
            </div>
          </div>

          <div className="surface-card p-5 text-[12px] text-[var(--color-text-muted)]">
            <p>
              {offCount === 0
                ? titleCase("Every module is on.")
                : `${offCount} ${offCount === 1 ? "module" : "modules"} switched off.`}
              {dirty ? "" : titleCase(" All changes saved.")}
            </p>
            <p className="mt-0.5 text-[var(--color-text-faint)]">
              {updatedAt ? `Last changed ${new Date(updatedAt).toLocaleString()}. ` : ""}
              {titleCase(
                "Takes effect for you on your next click; other signed-in users within about 30 seconds.",
              )}
            </p>
          </div>

          {/* Flipping a switch only edits local state — nothing is persisted
              until this bar's Save. It is fixed to the viewport and offset past
              the sidebar (same geometry as ExtractionRunBanner) so a pending
              save cannot scroll out of sight and be mistaken for "nothing
              happened". */}
          {dirty && (
            <div
              data-testid="configs-save-bar"
              role="region"
              aria-label="Unsaved changes"
              className="fixed bottom-4 left-4 right-4 z-[60] flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-copper)]/40 bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow-lg)] md:left-[calc(220px+1.5rem)] md:right-6"
            >
              <p className="text-[12.5px] font-semibold text-[var(--color-text)]">
                {changed.size === 0
                  ? titleCase("Unsaved changes")
                  : `${changed.size} ${changed.size === 1 ? "module" : "modules"} changed — not saved yet`}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="configs-reset"
                  disabled={saving}
                  onClick={() => setDraft(saved)}
                  className="btn-secondary h-9 px-4 text-[13px] disabled:opacity-45"
                >
                  {titleCase("Discard")}
                </button>
                <button
                  type="button"
                  data-testid="configs-save"
                  disabled={saving}
                  onClick={() => void save()}
                  className="btn-primary h-9 gap-2 px-4 text-[13px] disabled:opacity-45"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {saving ? titleCase("Saving…") : titleCase("Save changes")}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

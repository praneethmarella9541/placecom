"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Phone, Sparkles, Trash2, User, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase";
import { groupContactsFromExtraction } from "@/lib/contact-grouping";
import {
  getLabelSetting,
  getMaxEmailsSetting,
  getNotifyOnExtractionCompleteSetting,
  getSkipExtractedSetting,
  setLabelSetting,
  setMaxEmailsSetting,
  setNotifyOnExtractionCompleteSetting,
  setSkipExtractedSetting,
  type LabelOption,
  type MaxEmailsOption,
} from "@/lib/user-settings";
import { ensureExtractionNotificationPermission } from "@/lib/extraction-notify";
import { ExportButton } from "@/components/ExportButton";
import { ExtractionJobHistory } from "@/components/ExtractionJobHistory";
import { useExtractionRun } from "@/components/ExtractionRunProvider";
import { ProgressBar } from "@/components/ProgressBar";
import type { ResultRow } from "@/components/ResultsTable";
import { ResultsTable } from "@/components/ResultsTable";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";

/* ── Toggle Switch ─────────────────────────────────────────── */
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent",
        "transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40",
        checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-border-strong)]",
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm",
          "transform transition-transform duration-200 ease-in-out",
          checked ? "translate-x-4" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

/* ── KPI Card ──────────────────────────────────────────────── */
function KpiCard({
  value,
  label,
  icon: Icon,
  accent,
  delay = 0,
}: {
  value: number;
  label: string;
  icon: React.ElementType;
  accent: string;
  delay?: number;
}) {
  return (
    <div
      className="animate-fade-up surface-card group relative overflow-hidden rounded-2xl p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]"
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      {/* Accent glow in corner */}
      <div
        className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-10 blur-2xl transition-opacity duration-300 group-hover:opacity-20"
        style={{ background: accent }}
      />
      <div className="flex items-start justify-between">
        <div>
          <p
            className="font-display text-[40px] font-extrabold leading-none tracking-tight"
            style={{ color: accent }}
          >
            {value.toLocaleString()}
          </p>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
            {label}
          </p>
        </div>
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${accent}18` }}
        >
          <Icon className="h-4.5 w-4.5" style={{ color: accent }} strokeWidth={2} />
        </div>
      </div>
    </div>
  );
}

/* ── Select Field ──────────────────────────────────────────── */
function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block flex-1">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field h-[38px] cursor-pointer appearance-none bg-[image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22none%22><path d=%22M6 8l4 4 4-4%22 stroke=%22%2380868b%22 stroke-width=%221.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/></svg>')] bg-[right_10px_center] bg-no-repeat pr-8 text-[13px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ── Toggle Row ────────────────────────────────────────────── */
function ToggleRow({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <Toggle checked={checked} onChange={onChange} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-tight text-[var(--color-text)]">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-text-faint)]">
          {description}
        </p>
      </div>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────── */
export default function DashboardPage() {
  const supabase = createClient();
  const {
    phase,
    busy,
    error,
    lastRunSummary,
    progress,
    progressMax,
    progressLabel,
    progressHint,
    gmailListReady,
    jobHistoryKey,
    startRun,
    onRunComplete,
  } = useExtractionRun();

  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);

  const [maxEmails, setMax] = useState<MaxEmailsOption>("50");
  const [label, setLab] = useState<LabelOption>("inbox");
  const [skipExtracted, setSkipExtracted] = useState(true);
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);

  const loadExtractions = useCallback(async () => {
    setLoadingRows(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setRows([]);
      setLoadingRows(false);
      return;
    }

    const { data, error: qErr } = await supabase
      .from("email_extractions")
      .select(
        "id, subject, sender, body, extracted_names, extracted_phones, extracted_emails, extracted_contacts, position"
      )
      .eq("user_id", user.id)
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (qErr) {
      console.error(qErr);
      setLoadingRows(false);
      return;
    }

    setRows(
      (data || []).map((r) => {
        const names = (r.extracted_names as string[]) || [];
        const phones = (r.extracted_phones as string[]) || [];
        const emails = (r.extracted_emails as string[]) || [];
        const stored = r.extracted_contacts as
          | { name: string | null; email: string | null; phone: string | null }[]
          | null
          | undefined;
        const contacts =
          stored && Array.isArray(stored) && stored.length > 0
            ? stored
            : groupContactsFromExtraction({
                subject: (r.subject as string) || "",
                body: (r.body as string) || "",
                sender: (r.sender as string) || "",
                names,
                phones,
                emails,
              });
        return {
          id: r.id as string,
          subject: r.subject as string | null,
          sender: r.sender as string | null,
          names,
          phones,
          emails,
          contacts,
        };
      })
    );
    setLoadingRows(false);
  }, [supabase]);

  const kpiNames = useMemo(() => rows.reduce((a, r) => a + r.names.length, 0), [rows]);
  const kpiPhones = useMemo(() => rows.reduce((a, r) => a + r.phones.length, 0), [rows]);
  const kpiEmails = useMemo(() => rows.reduce((a, r) => a + r.emails.length, 0), [rows]);

  useEffect(() => {
    void loadExtractions();
  }, [loadExtractions]);

  useEffect(() => {
    return onRunComplete(() => {
      void loadExtractions();
    });
  }, [onRunComplete, loadExtractions]);

  useEffect(() => {
    setMax(getMaxEmailsSetting());
    setLab(getLabelSetting());
    setSkipExtracted(getSkipExtractedSetting());
    setNotifyOnComplete(getNotifyOnExtractionCompleteSetting());
    setSettingsReady(true);
  }, []);

  function handleSkipExtractedChange(checked: boolean) {
    setSkipExtracted(checked);
    setSkipExtractedSetting(checked);
    showMsg("Preferences saved on this device.");
  }

  async function handleNotifyChange(checked: boolean) {
    setNotifyOnComplete(checked);
    setNotifyOnExtractionCompleteSetting(checked);
    if (checked) await ensureExtractionNotificationPermission();
    showMsg("Preferences saved on this device.");
  }

  function handleMaxEmailsChange(next: MaxEmailsOption) {
    setMax(next);
    setMaxEmailsSetting(next);
    showMsg("Preferences saved on this device.");
  }

  function handleLabelChange(next: LabelOption) {
    setLab(next);
    setLabelSetting(next);
    showMsg("Preferences saved on this device.");
  }

  function showMsg(msg: string) {
    setSettingsMsg(titleCase(msg));
    setTimeout(() => setSettingsMsg(null), 2500);
  }

  async function deleteAllExtractions() {
    if (
      !window.confirm(
        titleCase(
          "Delete all extraction jobs and stored email rows for your account? This cannot be undone."
        )
      )
    ) {
      return;
    }
    setDeleting(true);
    setSettingsMsg(null);
    try {
      const res = await fetch("/api/delete-extractions", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Delete failed");
      showMsg("All extracted data removed.");
      await loadExtractions();
    } catch (e) {
      setSettingsMsg(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="animate-fade-up flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" style={{ animationDuration: "0.3s" }}>
        <div>
          <h1 className="font-display text-[22px] font-bold tracking-tight text-[var(--color-text)]">
            {titleCase("Email Extraction")}
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-text-faint)]">
            {titleCase("Extract contacts and data from your Gmail inbox")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ExportButton />
        </div>
      </div>

      {/* ── KPI row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard value={kpiNames}  label="Names Extracted" icon={User}  accent="#1a73e8" delay={0} />
        <KpiCard value={kpiPhones} label="Phones Found"    icon={Phone} accent="#188038" delay={60} />
        <KpiCard value={kpiEmails} label="Emails Found"    icon={Mail}  accent="#f29900" delay={120} />
      </div>

      {/* ── Run panel ─────────────────────────────────────────── */}
      <div
        className="animate-fade-up surface-card overflow-hidden rounded-2xl"
        style={{ animationDelay: "160ms", animationFillMode: "both" }}
      >
        {/* Gradient header strip */}
        <div className="flex flex-col gap-4 bg-gradient-to-r from-[var(--color-primary-tint)] to-[var(--color-surface)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-primary)] shadow-sm">
              <Zap className="h-4 w-4 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-[var(--color-text)]">
                {titleCase("Run Extraction")}
              </p>
              <p className="text-[12px] text-[var(--color-text-faint)]">
                {titleCase("Fetch messages from Gmail and extract contacts")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void startRun()}
              disabled={busy}
              className="btn-primary gap-2 shadow-sm"
            >
              {busy ? (
                <>
                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {titleCase("Working…")}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
                  {titleCase("Start Extraction")}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void deleteAllExtractions()}
              disabled={busy || deleting}
              className="btn-ghost gap-1.5 text-[var(--color-danger)] text-[13px] hover:bg-red-50 hover:text-[var(--color-danger)] dark:hover:bg-red-950/30"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              {deleting ? titleCase("Deleting…") : titleCase("Delete All")}
            </button>
          </div>
        </div>

        {/* Progress / result strip */}
        {busy && (
          <div className="border-t border-[var(--color-border)] px-5 py-4">
            <ProgressBar
              value={progress}
              max={Math.max(progressMax, 1)}
              label={progressLabel || "Progress"}
              hint={progressHint}
              indeterminate={phase === "fetching" && !gmailListReady}
            />
          </div>
        )}

        {error && (
          <div
            className="border-t border-red-200 bg-red-50 px-5 py-3 text-[13px] text-red-700 dark:border-red-900/40 dark:bg-red-950/25 dark:text-red-300"
            role="alert"
          >
            {error}
          </div>
        )}

        {phase === "done" && !error && (
          <div className="border-t border-[var(--color-primary-light)] bg-[var(--color-primary-tint)] px-5 py-3 text-[13px] text-[var(--color-primary)]">
            {lastRunSummary ||
              titleCase(`Extraction complete — ${progressMax} emails processed.`)}
          </div>
        )}
      </div>

      {/* ── Settings card ────────────────────────────────────── */}
      {!settingsReady ? (
        <div className="surface-card rounded-2xl p-5">
          <Skeleton className="skeleton-shimmer h-5 w-36 rounded-lg" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="skeleton-shimmer h-[38px] w-full rounded-lg" />
            <Skeleton className="skeleton-shimmer h-[38px] w-full rounded-lg" />
          </div>
        </div>
      ) : (
        <div
          className="animate-fade-up surface-card rounded-2xl p-5"
          style={{ animationDelay: "200ms", animationFillMode: "both" }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-[14px] font-semibold text-[var(--color-text)]">
              {titleCase("Extraction Settings")}
            </h2>
            {settingsMsg && (
              <span className="animate-fade-in text-[11px] font-medium text-[var(--color-success)]">
                {settingsMsg}
              </span>
            )}
          </div>

          {/* Dropdowns */}
          <div className="flex flex-col gap-4 sm:flex-row">
            <SelectField
              label="Emails to Scan"
              value={maxEmails}
              onChange={(v) => handleMaxEmailsChange(v as MaxEmailsOption)}
              options={[
                { value: "10", label: "10 emails" },
                { value: "50", label: "50 emails" },
                { value: "100", label: "100 emails" },
                { value: "500", label: "500 emails" },
                { value: "all", label: "All (up to 10,000)" },
              ]}
            />
            <SelectField
              label="Gmail Label"
              value={label}
              onChange={(v) => handleLabelChange(v as LabelOption)}
              options={[
                { value: "inbox", label: "Inbox" },
                { value: "sent", label: "Sent" },
                { value: "all", label: "All Mail" },
              ]}
            />
          </div>

          {/* Toggles */}
          <div className="mt-5 space-y-4 border-t border-[var(--color-border)] pt-4">
            <ToggleRow
              checked={skipExtracted}
              onChange={handleSkipExtractedChange}
              title={titleCase("Skip already extracted emails")}
              description={titleCase(
                "Re-runs update existing rows instead of duplicating. Skipped messages are not sent to OpenAI again."
              )}
            />
            <ToggleRow
              checked={notifyOnComplete}
              onChange={(v) => void handleNotifyChange(v)}
              title={titleCase("Notify when extraction completes")}
              description={titleCase(
                "Browser notification when finished. Runs continue in the background while you navigate."
              )}
            />
          </div>
        </div>
      )}

      {/* ── Job history ──────────────────────────────────────── */}
      <div
        className="animate-fade-up surface-card rounded-2xl p-5"
        style={{ animationDelay: "240ms", animationFillMode: "both" }}
      >
        <ExtractionJobHistory refreshKey={jobHistoryKey} />
      </div>

      {/* ── Results table ────────────────────────────────────── */}
      <div
        className="animate-fade-up surface-card overflow-hidden rounded-2xl"
        style={{ animationDelay: "280ms", animationFillMode: "both" }}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-offset)]/50 px-5 py-3">
          <h2 className="font-display text-[14px] font-semibold text-[var(--color-text)]">
            {titleCase("Results")}
          </h2>
          {rows.length > 0 && (
            <span className="rounded-full bg-[var(--color-primary-light)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--color-primary)]">
              {rows.length.toLocaleString()} {rows.length === 1 ? "row" : "rows"}
            </span>
          )}
        </div>

        {loadingRows ? (
          <div className="space-y-2 p-5">
            <Skeleton className="skeleton-shimmer h-11 w-full rounded-lg" />
            <Skeleton className="skeleton-shimmer h-11 w-full rounded-lg" />
            <Skeleton className="skeleton-shimmer h-11 w-full rounded-lg" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-20">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-offset)]">
              <Sparkles className="h-6 w-6 text-[var(--color-text-faint)]" strokeWidth={1.5} />
            </div>
            <p className="font-display mt-4 text-[16px] font-bold text-[var(--color-text)]">
              {titleCase("No extractions yet")}
            </p>
            <p className="mt-1.5 max-w-xs text-center text-[13px] text-[var(--color-text-muted)]">
              {titleCase("Configure settings above and run your first extraction.")}
            </p>
            <button
              type="button"
              onClick={() => void startRun()}
              disabled={busy}
              className="btn-primary mt-5 gap-2"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              {titleCase("Start Extraction")}
            </button>
          </div>
        ) : (
          <ResultsTable rows={rows} />
        )}
      </div>
    </div>
  );
}

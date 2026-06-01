"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { GmailLabelFilter } from "@/lib/gmail";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { groupContactsFromExtraction } from "@/lib/contact-grouping";
import {
  getLabelSetting,
  getMaxEmailsSetting,
  getSkipExtractedSetting,
  parseMaxEmails,
  setLabelSetting,
  setMaxEmailsSetting,
  setSkipExtractedSetting,
  type LabelOption,
  type MaxEmailsOption,
} from "@/lib/user-settings";
import { getExtractHttpBatchSize } from "@/lib/extract-config";
import { ExportButton } from "@/components/ExportButton";
import { ExtractionJobHistory } from "@/components/ExtractionJobHistory";
import { ProgressBar } from "@/components/ProgressBar";
import type { ResultRow } from "@/components/ResultsTable";
import { ResultsTable } from "@/components/ResultsTable";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";

type Phase = "idle" | "fetching" | "extracting" | "done" | "error";
const CHUNK = getExtractHttpBatchSize();

type FetchStreamMsg =
  | { type: "listing"; listed: number }
  | { type: "list"; total: number }
  | { type: "bodies"; done: number; total: number }
  | {
      type: "complete";
      emails: {
        id: string;
        subject: string;
        from: string;
        body: string;
        date: string;
        images?: string[];
      }[];
    }
  | { type: "error"; code?: string; message?: string };

export default function DashboardPage() {
  const supabase = createClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMax, setProgressMax] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [progressHint, setProgressHint] = useState("");
  /** After Gmail list completes we know total and show determinate download progress. */
  const [gmailListReady, setGmailListReady] = useState(false);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);

  const [maxEmails, setMax] = useState<MaxEmailsOption>("50");
  const [label, setLab] = useState<LabelOption>("inbox");
  const [skipExtracted, setSkipExtracted] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [jobHistoryKey, setJobHistoryKey] = useState(0);
  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null);

  const loadExtractions = useCallback(async () => {
    setLoadingRows(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRows([]); setLoadingRows(false); return; }

    const { data, error: qErr } = await supabase
      .from("email_extractions")
      .select(
        "id, subject, sender, body, extracted_names, extracted_phones, extracted_emails, extracted_contacts, position"
      )
      .eq("user_id", user.id)
      .order("position", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (qErr) { console.error(qErr); setLoadingRows(false); return; }

    setRows((data || []).map((r) => {
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
    }));
    setLoadingRows(false);
  }, [supabase]);

  const kpiNames = useMemo(() => rows.reduce((a, r) => a + r.names.length, 0), [rows]);
  const kpiPhones = useMemo(() => rows.reduce((a, r) => a + r.phones.length, 0), [rows]);
  const kpiEmails = useMemo(() => rows.reduce((a, r) => a + r.emails.length, 0), [rows]);

  useEffect(() => { void loadExtractions(); }, [loadExtractions]);

  useEffect(() => {
    setMax(getMaxEmailsSetting());
    setLab(getLabelSetting());
    setSkipExtracted(getSkipExtractedSetting());
    setSettingsReady(true);
  }, []);

  async function fetchExistingEmailIds(): Promise<Set<string>> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return new Set();
    const { data, error } = await supabase
      .from("email_extractions")
      .select("email_id")
      .eq("user_id", user.id);
    if (error) {
      console.error(error);
      return new Set();
    }
    return new Set((data ?? []).map((r) => r.email_id as string).filter(Boolean));
  }

  function handleSkipExtractedChange(checked: boolean) {
    setSkipExtracted(checked);
    setSkipExtractedSetting(checked);
    setSettingsMsg(titleCase("Preferences saved on this device."));
    setTimeout(() => setSettingsMsg(null), 2500);
  }

  function savePreferences() {
    setMaxEmailsSetting(maxEmails);
    setLabelSetting(label);
    setSettingsMsg(titleCase("Preferences saved on this device."));
    setTimeout(() => setSettingsMsg(null), 2500);
  }

  function handleMaxEmailsChange(next: MaxEmailsOption) {
    setMax(next);
    setMaxEmailsSetting(next);
    setSettingsMsg(titleCase("Preferences saved on this device."));
    setTimeout(() => setSettingsMsg(null), 2500);
  }

  function handleLabelChange(next: LabelOption) {
    setLab(next);
    setLabelSetting(next);
    setSettingsMsg(titleCase("Preferences saved on this device."));
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
      setSettingsMsg(titleCase("All extracted data removed."));
      setLastRunSummary(null);
      await loadExtractions();
      setJobHistoryKey((k) => k + 1);
    } catch (e) {
      setSettingsMsg(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  async function runPipeline() {
    setError(null);
    setLastRunSummary(null);
    setPhase("fetching");
    setProgress(0);
    setProgressMax(1);
    setGmailListReady(false);
    setProgressHint("");
    setProgressLabel(titleCase("Connecting to Gmail…"));

    const maxEmails = parseMaxEmails(getMaxEmailsSetting());
    const labelFilter = getLabelSetting() as GmailLabelFilter;

    let jobRes: Response;
    try {
      jobRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total_emails: 0 }),
      });
    } catch (e) { setError(clientFetchFailedMessage(e)); setPhase("error"); return; }
    if (!jobRes.ok) {
      const j = await jobRes.json().catch(() => ({}));
      setError(j.error || "Failed to create job"); setPhase("error"); return;
    }

    const { job } = (await jobRes.json()) as { job: { id: string } };
    const jobId = job.id;

    try {
      const startRun = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "running" }),
      });
      if (!startRun.ok) {
        const j = await startRun.json().catch(() => ({}));
        setError(j.error || "Failed to start extraction job");
        setPhase("error");
        return;
      }
    } catch (e) {
      setError(clientFetchFailedMessage(e));
      setPhase("error");
      return;
    }

    let emails: {
      id: string;
      subject: string;
      from: string;
      body: string;
      date: string;
      images?: string[];
    }[] = [];
    try {
      const fetchRes = await fetch("/api/fetch-emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({
          maxEmails,
          labelFilter,
          stream: true,
        }),
      });
      if (fetchRes.status === 401) {
        const j = await fetchRes.json().catch(() => ({}));
        setError(j.message || "Google session expired. Please sign out and reconnect.");
        setPhase("error");
        return;
      }
      if (!fetchRes.ok) {
        const j = await fetchRes.json().catch(() => ({}));
        setError(
          typeof j.error === "string"
            ? j.error
            : typeof j.message === "string"
              ? j.message
              : "Failed to fetch emails"
        );
        setPhase("error");
        return;
      }
      if (!fetchRes.body) {
        setError("No response body from Gmail fetch.");
        setPhase("error");
        return;
      }

      setProgressHint(
        titleCase("Loading messages from your mailbox. Progress matches how many are loaded.")
      );
      const reader = fetchRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotComplete = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let msg: FetchStreamMsg;
          try {
            msg = JSON.parse(t) as FetchStreamMsg;
          } catch {
            setError("Invalid progress stream from server.");
            setPhase("error");
            return;
          }
          if (msg.type === "listing") {
            setProgressLabel(
              titleCase(`Listing messages in Gmail… (${msg.listed} found)`)
            );
          } else if (msg.type === "list") {
            setProgressMax(Math.max(msg.total, 1));
            setProgress(0);
            setGmailListReady(true);
            setProgressLabel(titleCase("Downloading message bodies…"));
          } else if (msg.type === "bodies") {
            setProgress(msg.done);
          } else if (msg.type === "complete") {
            emails = msg.emails;
            gotComplete = true;
          } else if (msg.type === "error") {
            if (msg.code === "UNAUTHORIZED") {
              setError(
                msg.message ||
                  "Google session expired. Please sign out and reconnect."
              );
            } else if (msg.code === "GMAIL_INSUFFICIENT_SCOPE") {
              setError(msg.message || "Gmail permission missing for this account.");
            } else {
              setError(msg.message || "Failed to fetch emails");
            }
            setPhase("error");
            return;
          }
        }
      }

      if (!gotComplete) {
        setError("Gmail fetch ended unexpectedly. Try again.");
        setPhase("error");
        return;
      }
    } catch (e) {
      setError(clientFetchFailedMessage(e));
      setPhase("error");
      return;
    }

    const fetchedCount = emails.length;
    let skippedCount = 0;
    if (getSkipExtractedSetting() && emails.length > 0) {
      const existing = await fetchExistingEmailIds();
      const before = emails.length;
      emails = emails.filter((e) => !existing.has(e.id));
      skippedCount = before - emails.length;
    }

    let patch: Response;
    try {
      patch = await fetch(`/api/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total_emails: (emails || []).length, status: "running" }),
      });
    } catch (e) { setError(clientFetchFailedMessage(e)); setPhase("error"); return; }
    if (!patch.ok) {
      const j = await patch.json().catch(() => ({}));
      setError(j.error || "Failed to update job"); setPhase("error"); return;
    }

    if (!emails || emails.length === 0) {
      try {
        const emptyDone = await fetch(`/api/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ total_emails: 0, status: "done" }),
        });
        if (!emptyDone.ok) {
          const j = await emptyDone.json().catch(() => ({}));
          setError(j.error || "Failed to finalize extraction job");
          setPhase("error");
          return;
        }
      } catch (e) {
        setError(clientFetchFailedMessage(e));
        setPhase("error");
        return;
      }
      setPhase("done");
      setProgressLabel("");
      setProgressHint("");
      if (skippedCount > 0) {
        setLastRunSummary(
          titleCase(
            `Fetched ${fetchedCount} — skipped ${skippedCount} already extracted, none left to process.`
          )
        );
      } else {
        setLastRunSummary(titleCase("No new messages to extract."));
      }
      await loadExtractions();
      setJobHistoryKey((k) => k + 1);
      return;
    }

    setPhase("extracting");
    setProgressMax(emails.length);
    setProgress(0);
    setGmailListReady(true);
    setProgressHint("");
    setProgressLabel(titleCase("Extracting contacts…"));
    const batchCount = Math.ceil(emails.length / CHUNK);

    for (let b = 0; b < batchCount; b++) {
      const startIdx = b * CHUNK;
      const slice = emails.slice(startIdx, startIdx + CHUNK);
      let exRes: Response;
      try {
        exRes = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId, jobTotalEmails: emails.length,
            batchIndex: b, batchCount,
            emails: slice.map((e, i) => ({
              id: e.id,
              subject: e.subject,
              body: e.body,
              from: e.from,
              date: e.date,
              position: startIdx + i,
              ...(e.images && e.images.length > 0 ? { images: e.images } : {}),
            })),
          }),
        });
      } catch (e) { setError(clientFetchFailedMessage(e)); setPhase("error"); return; }
      if (!exRes.ok) {
        const j = await exRes.json().catch(() => ({}));
        setError(typeof j.error === "string" ? j.error : "Extraction failed");
        setPhase("error"); return;
      }
      const body = (await exRes.json()) as {
        processedEmails?: number;
      };
      setProgress(body.processedEmails ?? (b + 1) * slice.length);
    }

    setPhase("done");
    setProgress(emails.length);
    setProgressLabel("");
    setProgressHint("");
    const parts = [
      titleCase(`Extracted ${emails.length} email${emails.length === 1 ? "" : "s"}.`),
    ];
    if (skippedCount > 0) {
      parts.push(titleCase(`Skipped ${skippedCount} already in your results.`));
    }
    if (fetchedCount > emails.length + skippedCount) {
      /* defensive — should not happen */
    }
    setLastRunSummary(parts.join(" "));
    await loadExtractions();
    setJobHistoryKey((k) => k + 1);
  }

  const busy = phase === "fetching" || phase === "extracting";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { n: kpiNames, label: "Names Extracted" },
          { n: kpiPhones, label: "Phones Found" },
          { n: kpiEmails, label: "Emails Found" },
        ].map((k) => (
          <div key={k.label} className="surface-card rounded-[var(--radius-lg)] p-5 sm:p-6">
            <p className="font-display text-[38px] font-extrabold leading-none text-[var(--color-primary)]">
              {k.n}
            </p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
              {titleCase(k.label)}
            </p>
          </div>
        ))}
      </div>

      {!settingsReady ? (
        <div className="surface-card p-6">
          <Skeleton className="skeleton-shimmer h-6 w-40 rounded-lg" />
          <div className="mt-4 space-y-4">
            <Skeleton className="skeleton-shimmer h-10 w-full rounded-[var(--radius-md)]" />
            <Skeleton className="skeleton-shimmer h-10 w-full rounded-[var(--radius-md)]" />
          </div>
        </div>
      ) : (
        <div className="surface-card rounded-[var(--radius-lg)] p-6">
          <h2 className="font-display text-[15px] font-bold text-[var(--color-text)]">
            {titleCase("Extraction Settings")}
          </h2>
          <div className="mt-4 flex flex-col gap-4 sm:flex-row">
            <label className="block flex-1 text-[13px] font-medium text-[var(--color-text-muted)]">
              {titleCase("Emails to Scan")}
              <select
                value={maxEmails}
                onChange={(e) => handleMaxEmailsChange(e.target.value as MaxEmailsOption)}
                className="input-field mt-2 h-[38px]"
              >
                <option value="10">10</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="500">500</option>
                <option value="all">{titleCase("All (up to 10,000)")}</option>
              </select>
            </label>
            <label className="block flex-1 text-[13px] font-medium text-[var(--color-text-muted)]">
              {titleCase("Gmail Label")}
              <select
                value={label}
                onChange={(e) => handleLabelChange(e.target.value as LabelOption)}
                className="input-field mt-2 h-[38px]"
              >
                <option value="inbox">{titleCase("Inbox")}</option>
                <option value="sent">{titleCase("Sent")}</option>
                <option value="all">{titleCase("All mail")}</option>
              </select>
            </label>
          </div>
          <label className="mt-4 flex cursor-pointer items-start gap-3 text-[13px] text-[var(--color-text-muted)]">
            <input
              type="checkbox"
              checked={skipExtracted}
              onChange={(e) => handleSkipExtractedChange(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)]"
            />
            <span>
              <span className="font-medium text-[var(--color-text)]">
                {titleCase("Skip already extracted emails")}
              </span>
              <span className="mt-0.5 block text-[12px] text-[var(--color-text-faint)]">
                {titleCase(
                  "Re-runs update existing rows instead of duplicating. Skipped messages are not sent to OpenAI again."
                )}
              </span>
            </span>
          </label>
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={savePreferences} className="btn-ghost text-[13px]">
              {titleCase("Save Preferences")}
            </button>
          </div>
        </div>
      )}

      {settingsMsg ? (
        <p className="text-sm text-[var(--color-text-muted)]" role="status">
          {settingsMsg}
        </p>
      ) : null}

      <div className="surface-card rounded-[var(--radius-lg)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {titleCase("Fetch messages from Gmail and run extraction.")}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={() => void runPipeline()} disabled={busy} className="btn-primary gap-2">
              {busy ? (
                <>
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  {titleCase("Working…")}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" strokeWidth={2} />
                  {titleCase("Start Extraction")}
                </>
              )}
            </button>
            <ExportButton />
            <button
              type="button"
              onClick={() => void deleteAllExtractions()}
              disabled={busy || deleting}
              className="btn-ghost gap-2 text-[var(--color-danger)] hover:bg-red-50 hover:text-[var(--color-danger)] dark:hover:bg-red-950/30"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
              {deleting ? titleCase("Deleting…") : titleCase("Delete All Data")}
            </button>
          </div>
        </div>

        {busy ? (
          <div className="mt-6">
            <ProgressBar
              value={progress}
              max={Math.max(progressMax, 1)}
              label={progressLabel || "Progress"}
              hint={progressHint}
              indeterminate={phase === "fetching" && !gmailListReady}
            />
          </div>
        ) : null}

        {error ? (
          <div
            className="mt-5 rounded-[var(--radius-lg)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {phase === "done" && !error && lastRunSummary ? (
          <div className="mt-5 space-y-2">
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-primary-light)] bg-[var(--color-primary-light)] px-4 py-3 text-sm text-[var(--color-primary)]">
              {lastRunSummary}
            </div>
          </div>
        ) : phase === "done" && !error ? (
          <div className="mt-5 space-y-2">
            <div className="rounded-[var(--radius-lg)] border border-[var(--color-primary-light)] bg-[var(--color-primary-light)] px-4 py-3 text-sm text-[var(--color-primary)]">
              {titleCase(`Extraction complete — ${progressMax} emails processed.`)}
            </div>
          </div>
        ) : null}
      </div>

      <div className="surface-card rounded-[var(--radius-lg)] p-6">
        <ExtractionJobHistory refreshKey={jobHistoryKey} />
      </div>

      <div className="surface-card overflow-hidden rounded-[var(--radius-lg)]">
        <h2 className="border-b border-[var(--color-border)] bg-[var(--color-surface-offset)] px-4 py-3 font-display text-[15px] font-bold text-[var(--color-text)]">
          {titleCase("Results")}
        </h2>
        {loadingRows ? (
          <div className="space-y-3 p-6">
            <Skeleton className="skeleton-shimmer h-12 w-full rounded-[var(--radius-md)]" />
            <Skeleton className="skeleton-shimmer h-12 w-full rounded-[var(--radius-md)]" />
            <Skeleton className="skeleton-shimmer h-12 w-full rounded-[var(--radius-md)]" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16">
            <Sparkles className="h-10 w-10 text-[var(--color-text-faint)]" strokeWidth={1.5} />
            <p className="font-display mt-4 text-[17px] font-bold text-[var(--color-text)]">
              {titleCase("No extractions yet")}
            </p>
            <p className="mt-2 max-w-md text-center text-sm text-[var(--color-text-muted)]">
              {titleCase("Configure settings above and run your first extraction.")}
            </p>
            <button type="button" onClick={() => void runPipeline()} disabled={busy} className="btn-primary mt-5 gap-2">
              <Sparkles className="h-4 w-4" strokeWidth={2} />
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

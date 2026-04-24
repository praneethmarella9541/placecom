"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import type { GmailLabelFilter } from "@/lib/gmail";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { groupContactsFromExtraction } from "@/lib/contact-grouping";
import {
  getLabelSetting,
  getMaxEmailsSetting,
  parseMaxEmails,
} from "@/lib/user-settings";
import { ExportButton } from "@/components/ExportButton";
import { ProgressBar } from "@/components/ProgressBar";
import type { ResultRow } from "@/components/ResultsTable";
import { ResultsTable } from "@/components/ResultsTable";
import { Skeleton } from "@/components/Skeleton";
import { IconPlay, IconSettings, IconUser, IconPhone, IconAtSign, IconMail } from "@/components/Icons";

type Phase = "idle" | "fetching" | "extracting" | "done" | "error";
const CHUNK = 20;

export default function DashboardPage() {
  const supabase = createClient();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMax, setProgressMax] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [openAiRunSummary, setOpenAiRunSummary] = useState<string | null>(null);

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

  useEffect(() => { void loadExtractions(); }, [loadExtractions]);

  async function runPipeline() {
    setError(null);
    setOpenAiRunSummary(null);
    setPhase("fetching");
    setProgress(0);
    setProgressMax(1);
    setProgressLabel("Connecting to Gmail…");

    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.provider_token;
    if (!accessToken) {
      setError("No Google access token in session. Sign out and sign in again.");
      setPhase("error");
      return;
    }

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

    let fetchRes: Response;
    try {
      fetchRes = await fetch("/api/fetch-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken, maxEmails, labelFilter }),
      });
    } catch (e) { setError(clientFetchFailedMessage(e)); setPhase("error"); return; }
    if (fetchRes.status === 401) {
      const j = await fetchRes.json().catch(() => ({}));
      setError(j.message || "Google session expired. Please sign out and reconnect.");
      setPhase("error"); return;
    }
    if (!fetchRes.ok) {
      const j = await fetchRes.json().catch(() => ({}));
      setError(j.error || "Failed to fetch emails"); setPhase("error"); return;
    }

    const { emails } = (await fetchRes.json()) as {
      emails: { id: string; subject: string; from: string; body: string; date: string }[];
    };

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
      setPhase("done"); setProgressLabel(""); await loadExtractions(); return;
    }

    setPhase("extracting"); setProgressMax(emails.length); setProgress(0);
    setProgressLabel("Extracting with OpenAI (gpt-5-mini)…");
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
            emails: slice.map((e, i) => ({ id: e.id, subject: e.subject, body: e.body, from: e.from, date: e.date, position: startIdx + i })),
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
        openai?: {
          jobCostUsd?: number;
          jobInputTokens?: number;
          jobOutputTokens?: number;
          batchCostUsd?: number;
        };
      };
      setProgress(body.processedEmails ?? (b + 1) * slice.length);
      if (body.openai && typeof body.openai.jobCostUsd === "number") {
        const c = body.openai.jobCostUsd;
        const ins = body.openai.jobInputTokens ?? 0;
        const outs = body.openai.jobOutputTokens ?? 0;
        setOpenAiRunSummary(
          `This job (OpenAI): ~$${c.toFixed(4)} USD · ${ins.toLocaleString()} input + ${outs.toLocaleString()} output tokens (estimated; see https://platform.openai.com/docs/pricing).`
        );
      }
    }

    setPhase("done"); setProgress(emails.length); setProgressLabel("");
    await loadExtractions();
  }

  const busy = phase === "fetching" || phase === "extracting";
  const totalNames = rows.reduce((s, r) => s + r.names.length, 0);
  const totalPhones = rows.reduce((s, r) => s + r.phones.length, 0);
  const totalEmails = rows.reduce((s, r) => s + r.emails.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Extract names, phone numbers, and emails from Gmail.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton />
          <Link href="/settings" className="btn-ghost text-[13px]">
            <IconSettings className="h-4 w-4" /> Settings
          </Link>
        </div>
      </div>

      {!loadingRows && rows.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Names found", value: totalNames, icon: IconUser, badge: "badge-emerald" },
            { label: "Phone numbers", value: totalPhones, icon: IconPhone, badge: "badge-blue" },
            { label: "Emails found", value: totalEmails, icon: IconAtSign, badge: "badge-purple" },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="card flex items-center gap-4 p-5">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.badge}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                    {s.value.toLocaleString()}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{s.label}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
              <IconMail className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Run extraction</h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Adjust volume and labels in Settings.</p>
            </div>
          </div>
          <button type="button" onClick={() => void runPipeline()} disabled={busy} className="btn-primary">
            {busy ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                Working…
              </>
            ) : (
              <><IconPlay className="h-4 w-4" /> Start Extraction</>
            )}
          </button>
        </div>

        {busy ? (
          <div className="mt-6">
            <ProgressBar value={progress} max={Math.max(progressMax, 1)} label={progressLabel || "Progress"} indeterminate={phase === "fetching"} />
          </div>
        ) : null}

        {error ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-100" role="alert">
            {error}
          </div>
        ) : null}

        {phase === "done" && !error ? (
          <div className="mt-5 space-y-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
              Extraction complete — {progressMax} emails processed.
            </div>
            {openAiRunSummary ? (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                {openAiRunSummary}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="card p-6">
        <h2 className="mb-5 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          Results
        </h2>
        {loadingRows ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 py-16 dark:border-zinc-700">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <IconMail className="h-7 w-7 text-zinc-400" />
            </div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No extractions yet</p>
            <p className="max-w-xs text-center text-xs text-zinc-500">
              Run your first extraction above. Results will appear here with search, badges, and CSV export.
            </p>
          </div>
        ) : (
          <ResultsTable rows={rows} />
        )}
      </div>
    </div>
  );
}

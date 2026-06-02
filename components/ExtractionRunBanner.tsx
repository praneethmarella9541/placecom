"use client";

import Link from "next/link";
import { Loader2, ScanText, X } from "lucide-react";
import { useExtractionRun } from "@/components/ExtractionRunProvider";
import { titleCase } from "@/lib/title-case";
import { ProgressBar } from "@/components/ProgressBar";

export function ExtractionRunBanner() {
  const {
    busy,
    phase,
    progress,
    progressMax,
    progressLabel,
    progressHint,
    gmailListReady,
    interruptedJob,
    resumeJob,
    dismissInterrupted,
  } = useExtractionRun();

  if (busy) {
    return (
      <div
        className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-lg rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg md:left-[calc(220px+1rem)] md:right-6"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <Loader2
            className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[var(--color-primary)]"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[var(--color-text)]">
              {titleCase("Extraction in progress")}
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
              {titleCase("You can navigate to other pages — this continues in the background.")}
            </p>
            <div className="mt-3">
              <ProgressBar
                value={progress}
                max={Math.max(progressMax, 1)}
                label={progressLabel || "Progress"}
                hint={progressHint}
                indeterminate={phase === "fetching" && !gmailListReady}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!interruptedJob) return null;

  const processed = interruptedJob.processed_emails ?? 0;
  const total = interruptedJob.total_emails ?? 0;
  const err = interruptedJob.error_message;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-lg rounded-[var(--radius-lg)] border border-amber-200 bg-amber-50 p-4 shadow-lg dark:border-amber-900/50 dark:bg-amber-950/40 md:left-[calc(220px+1rem)] md:right-6"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <ScanText className="mt-0.5 h-5 w-5 shrink-0 text-amber-800 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-amber-950 dark:text-amber-100">
            {titleCase("Extraction interrupted")}
          </p>
          <p className="mt-1 text-[12px] text-amber-900/90 dark:text-amber-200/90">
            {processed > 0 && total > 0
              ? titleCase(`${processed} of ${total} emails processed.`)
              : null}
            {err ? ` ${err}` : null}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary text-[12px]"
              onClick={() => void resumeJob(interruptedJob.id)}
            >
              {titleCase("Resume")}
            </button>
            <Link href="/dashboard" className="btn-ghost text-[12px]">
              {titleCase("Open extraction")}
            </Link>
            <button
              type="button"
              className="btn-ghost text-[12px] text-[var(--color-text-muted)]"
              onClick={dismissInterrupted}
            >
              {titleCase("Dismiss")}
            </button>
          </div>
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          className="shrink-0 rounded p-1 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
          onClick={dismissInterrupted}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

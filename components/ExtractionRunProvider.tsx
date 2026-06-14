"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase";
import { titleCase } from "@/lib/title-case";
import {
  getLabelSetting,
  getMaxEmailsSetting,
  getNotifyOnExtractionCompleteSetting,
  getSkipExtractedSetting,
} from "@/lib/user-settings";
import type { ExtractionEmailPayload } from "@/lib/extraction-types";
import { jobCanResume } from "@/lib/extraction-types";
import {
  createExtractionJob,
  fetchExistingEmailIds,
  fetchGmailForExtraction,
  filterSkipExtracted,
  patchJob,
  runExtractionBatches,
  type ExtractionPhase,
} from "@/lib/extraction-pipeline";
import {
  ensureExtractionNotificationPermission,
  notifyExtractionComplete,
} from "@/lib/extraction-notify";
import type { ExtractionJob } from "@/types/extraction";

const ACTIVE_JOB_KEY = "placecom_extraction_active_job";

type ExtractionRunContextValue = {
  phase: ExtractionPhase;
  busy: boolean;
  error: string | null;
  lastRunSummary: string | null;
  progress: number;
  progressMax: number;
  progressLabel: string;
  progressHint: string;
  gmailListReady: boolean;
  activeJobId: string | null;
  jobHistoryKey: number;
  interruptedJob: ExtractionJob | null;
  startRun: () => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
  dismissInterrupted: () => void;
  bumpJobHistory: () => void;
  onRunComplete: (listener: () => void) => () => void;
};

const ExtractionRunContext = createContext<ExtractionRunContextValue | null>(null);

export function useExtractionRun(): ExtractionRunContextValue {
  const ctx = useContext(ExtractionRunContext);
  if (!ctx) {
    throw new Error("useExtractionRun must be used within ExtractionRunProvider");
  }
  return ctx;
}

export function ExtractionRunProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const abortRef = useRef<AbortController | null>(null);
  const completeListeners = useRef(new Set<() => void>());

  const [phase, setPhase] = useState<ExtractionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastRunSummary, setLastRunSummary] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressMax, setProgressMax] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [progressHint, setProgressHint] = useState("");
  const [gmailListReady, setGmailListReady] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobHistoryKey, setJobHistoryKey] = useState(0);
  const [interruptedJob, setInterruptedJob] = useState<ExtractionJob | null>(null);

  const busy = phase === "fetching" || phase === "extracting";

  const bumpJobHistory = useCallback(() => {
    setJobHistoryKey((k) => k + 1);
  }, []);

  const onRunComplete = useCallback((listener: () => void) => {
    completeListeners.current.add(listener);
    return () => {
      completeListeners.current.delete(listener);
    };
  }, []);

  const fireComplete = useCallback(() => {
    bumpJobHistory();
    completeListeners.current.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  }, [bumpJobHistory]);

  const applyProgress = useCallback(
    (p: {
      phase?: ExtractionPhase;
      progress?: number;
      progressMax?: number;
      progressLabel?: string;
      progressHint?: string;
      gmailListReady?: boolean;
    }) => {
      if (p.phase !== undefined) setPhase(p.phase);
      if (p.progress !== undefined) setProgress(p.progress);
      if (p.progressMax !== undefined) setProgressMax(p.progressMax);
      if (p.progressLabel !== undefined) setProgressLabel(p.progressLabel);
      if (p.progressHint !== undefined) setProgressHint(p.progressHint);
      if (p.gmailListReady !== undefined) setGmailListReady(p.gmailListReady);
    },
    []
  );

  const finishWithError = useCallback(
    (message: string) => {
      setError(message);
      setPhase("error");
      applyProgress({ progressLabel: "", progressHint: "" });
      try {
        sessionStorage.removeItem(ACTIVE_JOB_KEY);
      } catch {
        /* ignore */
      }
      fireComplete();
    },
    [applyProgress, fireComplete]
  );

  const finishSuccess = useCallback(
    (summary: string, notifyTitle: string) => {
      setLastRunSummary(summary);
      setPhase("done");
      setError(null);
      applyProgress({ progressLabel: "", progressHint: "" });
      try {
        sessionStorage.removeItem(ACTIVE_JOB_KEY);
      } catch {
        /* ignore */
      }
      setActiveJobId(null);
      setInterruptedJob(null);
      notifyExtractionComplete({
        title: notifyTitle,
        body: summary,
      });
      fireComplete();
    },
    [applyProgress, fireComplete]
  );

  const checkInterruptedJobs = useCallback(async () => {
    if (busy) return;
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      const body = (await res.json()) as { jobs?: ExtractionJob[] };
      if (!res.ok || !body.jobs?.length) return;

      const storedId =
        typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem(ACTIVE_JOB_KEY)
          : null;

      const candidate =
        (storedId ? body.jobs.find((j) => j.id === storedId) : null) ??
        body.jobs.find((j) => jobCanResume(j));

      if (candidate && jobCanResume(candidate)) {
        setInterruptedJob(candidate);
      }
    } catch {
      /* ignore */
    }
  }, [busy]);

  useEffect(() => {
    void checkInterruptedJobs();
  }, [checkInterruptedJobs]);

  const runExtractPhase = useCallback(
    async (options: {
      jobId: string;
      emails: ExtractionEmailPayload[];
      startBatchIndex: number;
      fetchedCount: number;
      skippedCount: number;
      signal: AbortSignal;
    }) => {
      const result = await runExtractionBatches({
        jobId: options.jobId,
        emails: options.emails,
        startBatchIndex: options.startBatchIndex,
        fetchedCount: options.fetchedCount,
        skippedCount: options.skippedCount,
        signal: options.signal,
        cb: {
          onProgress: (p) => applyProgress(p),
          onError: (msg) => finishWithError(msg),
        },
      });

      if (result.ok) {
        finishSuccess(
          titleCase(result.summary),
          titleCase("Extraction complete")
        );
        return;
      }

      setPhase("error");
      setError(
        titleCase(
          `${result.error} Use Resume to continue from the last failed batch.`
        )
      );
      applyProgress({ progressLabel: "", progressHint: "" });
      void checkInterruptedJobs();
      fireComplete();
    },
    [applyProgress, checkInterruptedJobs, finishSuccess, finishWithError, fireComplete]
  );

  const resumeJob = useCallback(
    async (jobId: string) => {
      if (busy) return;

      setError(null);
      setLastRunSummary(null);
      setInterruptedJob(null);

      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      let job: ExtractionJob;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const body = (await res.json()) as { job?: ExtractionJob; error?: string };
        if (!res.ok || !body.job) {
          finishWithError(body.error || "Job not found");
          return;
        }
        job = body.job;
      } catch (e) {
        finishWithError(e instanceof Error ? e.message : "Failed to load job");
        return;
      }

      const pending = job.pending_emails;
      if (!pending?.length || !jobCanResume(job)) {
        finishWithError("This job cannot be resumed.");
        return;
      }

      setActiveJobId(jobId);
      try {
        sessionStorage.setItem(ACTIVE_JOB_KEY, jobId);
      } catch {
        /* ignore */
      }

      if (getNotifyOnExtractionCompleteSetting()) {
        void ensureExtractionNotificationPermission();
      }

      await patchJob(jobId, { status: "running", error_message: null });

      const startBatch = job.next_batch_index ?? 0;
      await runExtractPhase({
        jobId,
        emails: pending,
        startBatchIndex: startBatch,
        fetchedCount: job.fetched_count ?? pending.length,
        skippedCount: job.skipped_count ?? 0,
        signal: ac.signal,
      });
    },
    [busy, finishWithError, runExtractPhase]
  );

  const startRun = useCallback(async () => {
    if (busy) return;

    setError(null);
    setLastRunSummary(null);
    setInterruptedJob(null);
    setPhase("fetching");
    setProgress(0);
    setProgressMax(1);
    setGmailListReady(false);
    setProgressHint("");
    setProgressLabel(titleCase("Connecting to Gmail…"));

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    if (getNotifyOnExtractionCompleteSetting()) {
      void ensureExtractionNotificationPermission();
    }

    const created = await createExtractionJob();
    if ("error" in created) {
      finishWithError(created.error);
      return;
    }
    const jobId = created.jobId;
    setActiveJobId(jobId);
    try {
      sessionStorage.setItem(ACTIVE_JOB_KEY, jobId);
    } catch {
      /* ignore */
    }

    const startPatch = await patchJob(jobId, { status: "running" });
    if (!startPatch.ok) {
      finishWithError(startPatch.error || "Failed to start job");
      return;
    }

    const maxEmails = getMaxEmailsSetting();
    const labelFilter = getLabelSetting();
    const skipExisting = getSkipExtractedSetting();
    const excludeIds = skipExisting ? await fetchExistingEmailIds(supabase) : undefined;

    const fetchResult = await fetchGmailForExtraction(
      maxEmails,
      labelFilter,
      {
        onProgress: (p) => applyProgress(p),
        onError: (msg) => finishWithError(msg),
      },
      ac.signal,
      excludeIds && excludeIds.size > 0 ? { excludeIds } : undefined
    );

    if ("error" in fetchResult) {
      await patchJob(jobId, { status: "error", error_message: fetchResult.error });
      finishWithError(fetchResult.error);
      return;
    }

    const fetchedCount = fetchResult.emails.length;
    const { emails, skippedCount: extraSkipped } = await filterSkipExtracted(
      supabase,
      fetchResult.emails
    );
    const skippedCount = fetchResult.skippedCount + extraSkipped;

    await runExtractPhase({
      jobId,
      emails,
      startBatchIndex: 0,
      fetchedCount,
      skippedCount,
      signal: ac.signal,
    });
  }, [
    busy,
    supabase,
    applyProgress,
    finishWithError,
    runExtractPhase,
  ]);

  const dismissInterrupted = useCallback(() => {
    setInterruptedJob(null);
    try {
      sessionStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({
      phase,
      busy,
      error,
      lastRunSummary,
      progress,
      progressMax,
      progressLabel,
      progressHint,
      gmailListReady,
      activeJobId,
      jobHistoryKey,
      interruptedJob,
      startRun,
      resumeJob,
      dismissInterrupted,
      bumpJobHistory,
      onRunComplete,
    }),
    [
      phase,
      busy,
      error,
      lastRunSummary,
      progress,
      progressMax,
      progressLabel,
      progressHint,
      gmailListReady,
      activeJobId,
      jobHistoryKey,
      interruptedJob,
      startRun,
      resumeJob,
      dismissInterrupted,
      bumpJobHistory,
      onRunComplete,
    ]
  );

  return (
    <ExtractionRunContext.Provider value={value}>{children}</ExtractionRunContext.Provider>
  );
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GmailLabelFilter } from "@/lib/gmail";
import { clientFetchFailedMessage } from "@/lib/fetch-errors";
import { getExtractHttpBatchSize } from "@/lib/extract-config";
import { getSkipExtractedSetting } from "@/lib/user-settings";
import type { ExtractionEmailPayload } from "@/lib/extraction-types";
import { parseMaxEmails, type LabelOption, type MaxEmailsOption } from "@/lib/user-settings";

export type ExtractionPhase = "idle" | "fetching" | "extracting" | "done" | "error";

export type FetchStreamMsg =
  | { type: "listing"; listed: number; skipped?: number }
  | { type: "list"; total: number; skipped?: number }
  | { type: "bodies"; done: number; total: number }
  | { type: "complete"; emails: ExtractionEmailPayload[]; skippedCount?: number }
  | { type: "error"; code?: string; message?: string };

export type PipelineProgress = {
  phase: ExtractionPhase;
  progress: number;
  progressMax: number;
  progressLabel: string;
  progressHint: string;
  gmailListReady: boolean;
};

export type PipelineCallbacks = {
  onProgress: (p: Partial<PipelineProgress>) => void;
  onError: (message: string) => void;
};

const CHUNK = getExtractHttpBatchSize();

export async function fetchExistingEmailIds(
  supabase: SupabaseClient
): Promise<Set<string>> {
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

export async function patchJob(
  jobId: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/jobs/${jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: false, error: (j as { error?: string }).error || "Failed to update job" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: clientFetchFailedMessage(e) };
  }
}

export async function createExtractionJob(): Promise<
  { jobId: string } | { error: string }
> {
  try {
    const jobRes = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_emails: 0 }),
    });
    if (!jobRes.ok) {
      const j = await jobRes.json().catch(() => ({}));
      return { error: (j as { error?: string }).error || "Failed to create job" };
    }
    const { job } = (await jobRes.json()) as { job: { id: string } };
    return { jobId: job.id };
  } catch (e) {
    return { error: clientFetchFailedMessage(e) };
  }
}

export async function fetchGmailForExtraction(
  maxEmails: MaxEmailsOption,
  labelFilter: LabelOption,
  cb: PipelineCallbacks,
  signal?: AbortSignal,
  options?: { excludeIds?: Set<string> }
): Promise<{ emails: ExtractionEmailPayload[]; skippedCount: number } | { error: string }> {
  const parsedMax = parseMaxEmails(maxEmails);
  const excludeIds = options?.excludeIds;
  const skipExisting = Boolean(excludeIds && excludeIds.size > 0);

  cb.onProgress({
    phase: "fetching",
    progress: 0,
    progressMax: 1,
    gmailListReady: false,
    progressLabel: skipExisting
      ? "Scanning Gmail for new messages…"
      : "Connecting to Gmail…",
    progressHint: "",
  });

  let emails: ExtractionEmailPayload[] = [];
  let skippedCount = 0;

  try {
    const fetchRes = await fetch("/api/fetch-emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/x-ndjson",
      },
      body: JSON.stringify({
        maxEmails: parsedMax,
        labelFilter: labelFilter as GmailLabelFilter,
        stream: true,
        ...(excludeIds && excludeIds.size > 0
          ? { excludeEmailIds: Array.from(excludeIds) }
          : {}),
      }),
      signal,
    });

    if (fetchRes.status === 401) {
      const j = await fetchRes.json().catch(() => ({}));
      return {
        error:
          (j as { message?: string }).message ||
          "Google session expired. Please sign out and reconnect.",
      };
    }
    if (!fetchRes.ok) {
      const j = await fetchRes.json().catch(() => ({}));
      return {
        error: (j as { error?: string }).error || "Failed to fetch emails",
      };
    }

    const reader = fetchRes.body?.getReader();
    if (!reader) {
      return { error: "Gmail fetch returned no stream." };
    }

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
          return { error: "Invalid progress stream from server." };
        }
        if (msg.type === "listing") {
          const skipped = msg.skipped ?? 0;
          cb.onProgress({
            progressLabel:
              skipped > 0
                ? `Scanning Gmail… (${msg.listed} new, ${skipped} already extracted)`
                : `Listing messages in Gmail… (${msg.listed} found)`,
          });
        } else if (msg.type === "list") {
          skippedCount = msg.skipped ?? skippedCount;
          cb.onProgress({
            progressMax: Math.max(msg.total, 1),
            progress: 0,
            gmailListReady: true,
            progressLabel: "Downloading message bodies…",
          });
        } else if (msg.type === "bodies") {
          cb.onProgress({ progress: msg.done });
        } else if (msg.type === "complete") {
          emails = msg.emails;
          skippedCount = msg.skippedCount ?? skippedCount;
          gotComplete = true;
        } else if (msg.type === "error") {
          if (msg.code === "UNAUTHORIZED") {
            return {
              error:
                msg.message ||
                "Google session expired. Please sign out and reconnect.",
            };
          }
          if (msg.code === "GMAIL_INSUFFICIENT_SCOPE") {
            return {
              error: msg.message || "Gmail permission missing for this account.",
            };
          }
          return { error: msg.message || "Failed to fetch emails" };
        }
      }
    }

    if (!gotComplete) {
      return { error: "Gmail fetch ended unexpectedly. Try again." };
    }
  } catch (e) {
    if (signal?.aborted) return { error: "Extraction cancelled." };
    return { error: clientFetchFailedMessage(e) };
  }

  return { emails, skippedCount };
}

export async function filterSkipExtracted(
  supabase: SupabaseClient,
  emails: ExtractionEmailPayload[]
): Promise<{ emails: ExtractionEmailPayload[]; skippedCount: number }> {
  if (!getSkipExtractedSetting() || emails.length === 0) {
    return { emails, skippedCount: 0 };
  }
  const existing = await fetchExistingEmailIds(supabase);
  const before = emails.length;
  const filtered = emails.filter((e) => !existing.has(e.id));
  return { emails: filtered, skippedCount: before - filtered.length };
}

export type RunBatchesResult =
  | {
      ok: true;
      summary: string;
      extractedCount: number;
      skippedCount: number;
      fetchedCount: number;
    }
  | { ok: false; error: string; partial: boolean };

export async function runExtractionBatches(options: {
  jobId: string;
  emails: ExtractionEmailPayload[];
  startBatchIndex: number;
  fetchedCount: number;
  skippedCount: number;
  cb: PipelineCallbacks;
  signal?: AbortSignal;
}): Promise<RunBatchesResult> {
  const { jobId, emails, startBatchIndex, fetchedCount, skippedCount, cb, signal } =
    options;

  if (emails.length === 0) {
    await patchJob(jobId, {
      total_emails: 0,
      status: "done",
      pending_emails: null,
      batch_count: 0,
      next_batch_index: 0,
      fetched_count: fetchedCount,
      skipped_count: skippedCount,
    });
    const summary =
      skippedCount > 0
        ? `Scanned Gmail — skipped ${skippedCount} already extracted, no new messages left to process.`
        : "No new messages to extract.";
    cb.onProgress({ phase: "done", progressLabel: "", progressHint: "" });
    return { ok: true, summary, extractedCount: 0, skippedCount, fetchedCount };
  }

  const batchCount = Math.ceil(emails.length / CHUNK);

  await patchJob(jobId, {
    total_emails: emails.length,
    batch_count: batchCount,
    next_batch_index: startBatchIndex,
    pending_emails: emails,
    fetched_count: fetchedCount,
    skipped_count: skippedCount,
    status: "running",
    error_message: null,
  });

  cb.onProgress({
    phase: "extracting",
    progressMax: emails.length,
    progress: startBatchIndex * CHUNK,
    gmailListReady: true,
    progressHint: "",
    progressLabel: startBatchIndex > 0 ? "Resuming extraction…" : "Extracting contacts…",
  });

  for (let b = startBatchIndex; b < batchCount; b++) {
    if (signal?.aborted) {
      await patchJob(jobId, { status: "partial", error_message: "Cancelled by user." });
      return { ok: false, error: "Extraction cancelled.", partial: true };
    }

    const startIdx = b * CHUNK;
    const slice = emails.slice(startIdx, startIdx + CHUNK);

    let exRes: Response;
    try {
      exRes = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          jobTotalEmails: emails.length,
          batchIndex: b,
          batchCount,
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
        signal,
      });
    } catch (e) {
      const msg = clientFetchFailedMessage(e);
      await patchJob(jobId, {
        status: "partial",
        error_message: msg,
        next_batch_index: b,
        batch_count: batchCount,
        pending_emails: emails,
      });
      return { ok: false, error: msg, partial: true };
    }

    if (!exRes.ok) {
      const j = await exRes.json().catch(() => ({}));
      const msg =
        typeof (j as { error?: string }).error === "string"
          ? (j as { error: string }).error
          : "Extraction failed";
      return { ok: false, error: msg, partial: true };
    }

    const body = (await exRes.json()) as { processedEmails?: number };
    cb.onProgress({
      progress: body.processedEmails ?? Math.min((b + 1) * CHUNK, emails.length),
    });
  }

  await patchJob(jobId, {
    status: "done",
    pending_emails: null,
    next_batch_index: batchCount,
    error_message: null,
  });

  const parts = [`Extracted ${emails.length} email${emails.length === 1 ? "" : "s"}.`];
  if (skippedCount > 0) {
    parts.push(`Skipped ${skippedCount} already in your results.`);
  }

  cb.onProgress({
    phase: "done",
    progress: emails.length,
    progressLabel: "",
    progressHint: "",
  });

  return {
    ok: true,
    summary: parts.join(" "),
    extractedCount: emails.length,
    skippedCount,
    fetchedCount,
  };
}

export { CHUNK as extractionHttpBatchSize };

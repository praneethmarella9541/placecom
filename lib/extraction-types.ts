/** Gmail message payload used for extraction batches and job resume storage. */
export type ExtractionEmailPayload = {
  id: string;
  subject: string;
  from: string;
  body: string;
  date: string;
  images?: string[];
};

export type ExtractionJobResumeFields = {
  next_batch_index: number;
  batch_count: number;
  error_message: string | null;
  fetched_count: number;
  skipped_count: number;
  pending_emails: ExtractionEmailPayload[] | null;
};

export function jobCanResume(job: {
  status: string;
  pending_emails?: ExtractionEmailPayload[] | null;
  next_batch_index?: number;
  batch_count?: number;
}): boolean {
  const pending = job.pending_emails;
  if (!pending || !Array.isArray(pending) || pending.length === 0) return false;
  const next = job.next_batch_index ?? 0;
  const total = job.batch_count ?? 0;
  if (total <= 0) return false;
  if (next >= total) return false;
  return (
    job.status === "partial" ||
    job.status === "error" ||
    (job.status === "running" && next < total)
  );
}

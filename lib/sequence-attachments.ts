import "server-only";

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceSupabase } from "@/lib/supabase-service";
import type { SendAttachment } from "@/lib/gmail-inbox";
import type { SequenceStepAttachment } from "@/lib/sequence-types";

/**
 * Durable storage for sequence step attachments.
 *
 * Private bucket, reached only through the API routes and the cron — nothing
 * here is ever handed to a browser as a URL, so the files can't leak by being
 * guessable. Mirrors lib/whatsapp-media-storage.ts for bucket handling.
 */
export const SEQUENCE_ATTACHMENT_BUCKET = "sequence-attachments";

/** Gmail rejects anything over 25MB once base64 inflates it (~33% larger). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_STEP_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_STEP = 10;

let bucketReady: Promise<void> | null = null;

function ensureBucket(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Promise.resolve();
  }
  if (!bucketReady) {
    bucketReady = (async () => {
      const supabase = createServiceSupabase();
      // Private: these are one team's outbound files, and every read goes
      // through a route that has already checked who is asking.
      await supabase.storage
        .createBucket(SEQUENCE_ATTACHMENT_BUCKET, { public: false })
        .catch(() => {});
    })();
  }
  return bucketReady;
}

/** Keep the original name readable in storage without letting it shape the path. */
function safeName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

export type AttachmentRow = {
  id: string;
  step_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export function toAttachmentDto(row: AttachmentRow): SequenceStepAttachment {
  return {
    id: row.id,
    stepId: row.step_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export async function uploadStepAttachment(params: {
  mailboxOwnerId: string;
  sequenceId: string;
  stepId: string;
  file: Buffer;
  filename: string;
  mimeType: string;
}): Promise<string> {
  await ensureBucket();
  const supabase = createServiceSupabase();
  const objectPath = `${params.mailboxOwnerId}/${params.sequenceId}/${params.stepId}/${randomUUID()}-${safeName(params.filename)}`;

  const { error } = await supabase.storage
    .from(SEQUENCE_ATTACHMENT_BUCKET)
    .upload(objectPath, params.file, {
      contentType: params.mimeType || "application/octet-stream",
      upsert: false,
    });
  if (error) throw new Error(error.message);

  return objectPath;
}

/**
 * Delete the stored files for steps that are going away.
 *
 * The DB rows cascade with the step, but storage has no foreign keys — without
 * this, deleting a step would leave its bytes paid for and unreachable. Runs
 * before the delete, while the rows still say where the files are.
 */
export async function purgeAttachmentsForSteps(
  svc: SupabaseClient,
  stepIds: string[],
): Promise<void> {
  if (stepIds.length === 0) return;
  const { data } = await svc
    .from("sequence_step_attachments")
    .select("storage_path")
    .in("step_id", stepIds);
  const paths = ((data ?? []) as { storage_path: string }[]).map((r) => r.storage_path);
  if (paths.length === 0) return;

  await ensureBucket();
  const supabase = createServiceSupabase();
  await supabase.storage.from(SEQUENCE_ATTACHMENT_BUCKET).remove(paths).catch(() => {});
}

export async function removeStepAttachmentFile(storagePath: string): Promise<void> {
  await ensureBucket();
  const supabase = createServiceSupabase();
  // Best-effort: a stranded object costs storage, a failed delete of the row
  // would leave the file listed in an editor that can no longer remove it.
  await supabase.storage.from(SEQUENCE_ATTACHMENT_BUCKET).remove([storagePath]).catch(() => {});
}

/**
 * Attachments for one step, base64'd the way sendMailViaGmail wants them.
 *
 * Every recipient of a step gets the same files, so the caller is expected to
 * cache this per run rather than re-downloading per enrollment.
 */
export async function loadStepSendAttachments(
  stepId: string,
): Promise<SendAttachment[]> {
  await ensureBucket();
  const supabase = createServiceSupabase();

  const { data: rows } = await supabase
    .from("sequence_step_attachments")
    .select("storage_path, filename, mime_type")
    .eq("step_id", stepId)
    .order("created_at");

  const list = (rows ?? []) as { storage_path: string; filename: string; mime_type: string }[];
  const out: SendAttachment[] = [];

  for (const row of list) {
    const { data, error } = await supabase.storage
      .from(SEQUENCE_ATTACHMENT_BUCKET)
      .download(row.storage_path);
    // A file that has gone missing must not stop the email: the recipient is
    // better served by the mail arriving without it than by a send that never
    // happens and silently retries forever.
    if (error || !data) continue;
    const buffer = Buffer.from(await data.arrayBuffer());
    out.push({
      filename: row.filename,
      mimeType: row.mime_type || "application/octet-stream",
      base64Data: buffer.toString("base64"),
    });
  }

  return out;
}

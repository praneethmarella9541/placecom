import "server-only";

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceSupabase } from "@/lib/supabase-service";
import type { SendAttachment } from "@/lib/gmail-inbox";
import {
  createSignedUpload,
  ensurePrivateBucket,
  safeStorageName,
  storedObjectSize,
} from "@/lib/storage-signed-upload";
import { SEQUENCE_ATTACHMENT_BUCKET, type SequenceStepAttachment } from "@/lib/sequence-types";

export { SEQUENCE_ATTACHMENT_BUCKET };

/**
 * Durable storage for sequence step attachments.
 *
 * Private bucket, reached only through the API routes and the cron — nothing
 * here is ever handed to a browser as a URL, so the files can't leak by being
 * guessable. Uploads go straight from the browser to the bucket on a signed URL
 * (lib/storage-signed-upload).
 *
 * Same rule as compose and mail templates (sendsAsDriveLink): a file up to
 * Gmail's 25 MB is stored here and attached; a bigger one is kept as a Drive
 * link and sent in the body. No per-step total or count cap.
 */

const BUCKET = SEQUENCE_ATTACHMENT_BUCKET;

export type AttachmentRow = {
  id: string;
  step_id: string;
  /** Null for a Drive-linked file. */
  storage_path: string | null;
  drive_file_id: string | null;
  web_view_link: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export const ATTACHMENT_ROW_COLUMNS =
  "id, step_id, storage_path, drive_file_id, web_view_link, filename, mime_type, size_bytes, created_at";

export function toAttachmentDto(row: AttachmentRow): SequenceStepAttachment {
  return {
    id: row.id,
    stepId: row.step_id,
    filename: row.filename,
    mimeType: row.mime_type,
    // bigint arrives as a string from PostgREST once it outgrows a JS-safe int.
    sizeBytes: Number(row.size_bytes),
    createdAt: row.created_at,
    driveFileId: row.drive_file_id ?? null,
    webViewLink: row.web_view_link ?? null,
  };
}

function folderFor(mailboxOwnerId: string, sequenceId: string, stepId: string): string {
  return `${mailboxOwnerId}/${sequenceId}/${stepId}`;
}

/** True when `path` sits in this step's folder — it came back from the client. */
export function stepPathBelongsTo(
  path: string,
  mailboxOwnerId: string,
  sequenceId: string,
  stepId: string,
): boolean {
  const prefix = `${folderFor(mailboxOwnerId, sequenceId, stepId)}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
}

/** A one-shot signed URL the browser uploads one step file to. */
export function createStepUploadUrl(params: {
  mailboxOwnerId: string;
  sequenceId: string;
  stepId: string;
  filename: string;
}): Promise<{ path: string; token: string; signedUrl: string }> {
  const path = `${folderFor(params.mailboxOwnerId, params.sequenceId, params.stepId)}/${randomUUID()}-${safeStorageName(params.filename)}`;
  return createSignedUpload(BUCKET, path);
}

export function stepObjectSize(path: string): Promise<number | null> {
  return storedObjectSize(BUCKET, path);
}

/** Server-side upload — used when copying a mail template's files onto a step. */
export async function uploadStepAttachment(params: {
  mailboxOwnerId: string;
  sequenceId: string;
  stepId: string;
  file: Buffer;
  filename: string;
  mimeType: string;
}): Promise<string> {
  await ensurePrivateBucket(BUCKET);
  const objectPath = `${folderFor(params.mailboxOwnerId, params.sequenceId, params.stepId)}/${randomUUID()}-${safeStorageName(params.filename)}`;

  const { error } = await createServiceSupabase()
    .storage.from(BUCKET)
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
 * before the delete, while the rows still say where the files are. Drive-linked
 * files stay in the mailbox's Drive, as compose's do.
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
  const paths = ((data ?? []) as { storage_path: string | null }[])
    .map((r) => r.storage_path)
    .filter((p): p is string => !!p);
  if (paths.length === 0) return;

  await ensurePrivateBucket(BUCKET);
  await createServiceSupabase().storage.from(BUCKET).remove(paths).catch(() => {});
}

export async function removeStepAttachmentFile(storagePath: string | null): Promise<void> {
  if (!storagePath) return;
  await ensurePrivateBucket(BUCKET);
  // Best-effort: a stranded object costs storage, a failed delete of the row
  // would leave the file listed in an editor that can no longer remove it.
  await createServiceSupabase().storage.from(BUCKET).remove([storagePath]).catch(() => {});
}

/** A step file sent as a Drive link in the body rather than as an attachment. */
export type StepDriveLink = {
  kind: "drive";
  name: string;
  mimeType: string;
  size: number;
  driveFileId: string;
  webViewLink: string;
};

export type StepSendFiles = {
  /** Base64'd the way sendMailViaGmail wants them. */
  attachments: SendAttachment[];
  /** For appendDriveLinksToHtml. */
  driveLinks: StepDriveLink[];
};

/**
 * Everything one step sends: stored files as attachments, Drive-linked files
 * as links. Every recipient of a step gets the same files, so the caller is
 * expected to cache this per run rather than re-downloading per enrollment.
 */
export async function loadStepSendAttachments(stepId: string): Promise<StepSendFiles> {
  await ensurePrivateBucket(BUCKET);
  const supabase = createServiceSupabase();

  const { data: rows } = await supabase
    .from("sequence_step_attachments")
    .select("storage_path, drive_file_id, web_view_link, filename, mime_type, size_bytes")
    .eq("step_id", stepId)
    .order("created_at");

  const list = (rows ?? []) as Array<
    Pick<
      AttachmentRow,
      "storage_path" | "drive_file_id" | "web_view_link" | "filename" | "mime_type" | "size_bytes"
    >
  >;
  const out: StepSendFiles = { attachments: [], driveLinks: [] };

  for (const row of list) {
    const mimeType = row.mime_type || "application/octet-stream";
    if (!row.storage_path) {
      if (row.drive_file_id && row.web_view_link) {
        out.driveLinks.push({
          kind: "drive",
          name: row.filename,
          mimeType,
          size: Number(row.size_bytes),
          driveFileId: row.drive_file_id,
          webViewLink: row.web_view_link,
        });
      }
      continue;
    }

    const { data, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
    // A file that has gone missing must not stop the email: the recipient is
    // better served by the mail arriving without it than by a send that never
    // happens and silently retries forever.
    if (error || !data) continue;
    const buffer = Buffer.from(await data.arrayBuffer());
    out.attachments.push({
      filename: row.filename,
      mimeType,
      base64Data: buffer.toString("base64"),
    });
  }

  return out;
}

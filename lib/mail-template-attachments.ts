import "server-only";

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceSupabase } from "@/lib/supabase-service";
import {
  createSignedUpload,
  ensurePrivateBucket,
  safeStorageName,
  storedObjectSize,
} from "@/lib/storage-signed-upload";
import {
  MAIL_TEMPLATE_ATTACHMENT_BUCKET,
  MAIL_TEMPLATE_ATTACHMENT_COLUMNS,
  rowToMailTemplateAttachment,
  type MailTemplateAttachment,
  type MailTemplateAttachmentRow,
} from "@/lib/mail-template-types";

export { isValidDriveLink } from "@/lib/storage-signed-upload";

/**
 * Durable storage for mail template attachments — the template counterpart of
 * lib/sequence-attachments.ts. Uploads go straight from the browser to the
 * private bucket (lib/storage-signed-upload); a file over Gmail's 25 MB never
 * comes here at all and is kept on the template as a Drive link.
 */

const BUCKET = MAIL_TEMPLATE_ATTACHMENT_BUCKET;

/** Before migration 0068 the table is absent; templates still work without files. */
export function isMissingAttachmentTable(message: string): boolean {
  return /relation .*mail_template_attachments.* does not exist|could not find the table/i.test(
    message
  );
}

export const ATTACHMENT_MIGRATION_HINT =
  "Run migration 0068_mail_template_attachments.sql to attach files to templates.";

function folderFor(userId: string, templateId: string): string {
  return `${userId}/${templateId}`;
}

/**
 * Files are uploaded the moment they are picked, before Save — and before a
 * new template even has an id — so they land in a per-user uploads folder and
 * Save only records them against the template.
 */
function uploadsFolderFor(userId: string): string {
  return `${userId}/uploads`;
}

/** True when `path` is one of this user's picked-but-maybe-unsaved uploads — it came from the client. */
export function isUserUploadPath(path: string, userId: string): boolean {
  const prefix = `${uploadsFolderFor(userId)}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
}

/** True when `path` may be recorded on this template: an upload of this user's, or (older) its own folder. */
export function pathBelongsTo(path: string, userId: string, templateId: string): boolean {
  if (isUserUploadPath(path, userId)) return true;
  const prefix = `${folderFor(userId, templateId)}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
}

/** A one-shot signed URL for a file picked in the editor, before it belongs to a template. */
export function createUserUploadUrl(params: {
  userId: string;
  filename: string;
}): Promise<{ path: string; token: string; signedUrl: string }> {
  const path = `${uploadsFolderFor(params.userId)}/${randomUUID()}-${safeStorageName(params.filename)}`;
  return createSignedUpload(BUCKET, path);
}

/** Template id → its attachments, oldest first. Empty when the table is not there yet. */
export async function loadAttachmentsByTemplate(
  supabase: SupabaseClient,
  userId: string,
  templateIds: string[]
): Promise<Map<string, MailTemplateAttachment[]>> {
  const out = new Map<string, MailTemplateAttachment[]>();
  if (templateIds.length === 0) return out;

  const { data, error } = await supabase
    .from("mail_template_attachments")
    .select(MAIL_TEMPLATE_ATTACHMENT_COLUMNS)
    .eq("user_id", userId)
    .in("template_id", templateIds)
    .order("created_at");
  // A missing table means no template has files yet; any other failure should
  // not take the whole picker down with it either.
  if (error) return out;

  for (const row of (data ?? []) as MailTemplateAttachmentRow[]) {
    const list = out.get(row.template_id) ?? [];
    list.push(rowToMailTemplateAttachment(row));
    out.set(row.template_id, list);
  }
  return out;
}

/** A one-shot signed URL the browser uploads one file to. */
export function createTemplateUploadUrl(params: {
  userId: string;
  templateId: string;
  filename: string;
}): Promise<{ path: string; token: string; signedUrl: string }> {
  const path = `${folderFor(params.userId, params.templateId)}/${randomUUID()}-${safeStorageName(params.filename)}`;
  return createSignedUpload(BUCKET, path);
}

export function templateObjectSize(path: string): Promise<number | null> {
  return storedObjectSize(BUCKET, path);
}

export async function removeTemplateFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await ensurePrivateBucket(BUCKET);
  // Best-effort: a stranded object costs storage; failing the user's delete
  // over it would leave a file listed that they can no longer remove.
  await createServiceSupabase().storage.from(BUCKET).remove(paths).catch(() => {});
}

export async function downloadTemplateFile(path: string): Promise<Buffer | null> {
  await ensurePrivateBucket(BUCKET);
  const { data, error } = await createServiceSupabase().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export type TemplateFileRow = {
  id: string;
  /** Null for a Drive-linked file. */
  storage_path: string | null;
  drive_file_id: string | null;
  web_view_link: string | null;
  filename: string;
  mime_type: string;
  size_bytes: number;
};

/** A template's files with their storage paths — server use only, never sent to a browser. */
export async function loadTemplateFiles(
  supabase: SupabaseClient,
  userId: string,
  templateId: string
): Promise<{ rows: TemplateFileRow[]; error: string | null; missingTable: boolean }> {
  const { data, error } = await supabase
    .from("mail_template_attachments")
    .select("id, storage_path, drive_file_id, web_view_link, filename, mime_type, size_bytes")
    .eq("user_id", userId)
    .eq("template_id", templateId)
    .order("created_at");
  if (error) {
    const missingTable = isMissingAttachmentTable(error.message);
    return { rows: [], error: missingTable ? null : error.message, missingTable };
  }
  const rows = ((data ?? []) as TemplateFileRow[]).map((r) => ({
    ...r,
    size_bytes: Number(r.size_bytes),
  }));
  return { rows, error: null, missingTable: false };
}

/** Storage paths of the rows that have bytes in the bucket (Drive links have none). */
export function storedPaths(rows: Array<{ storage_path: string | null }>): string[] {
  return rows.map((r) => r.storage_path).filter((p): p is string => !!p);
}

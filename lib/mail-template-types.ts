/**
 * Shared DTOs and validation for saved mail templates — safe to import from
 * client components.
 *
 * "Template" is three different things in this codebase, so to be precise: a
 * MailTemplate is a *saved* subject + body a user pulls back into a draft. The
 * `{variable}` tokens inside it are the merge templates lib/mail-merge.ts
 * substitutes, and neither has anything to do with the Meta-approved
 * WhatsAppTemplateMeta in lib/whatsapp-template-shared.ts.
 */

import { GMAIL_ATTACHMENT_MAX_BYTES, sendsAsDriveLink } from "@/lib/gmail-draft-limits";

export type MailTemplateAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /**
   * Set when the file was over Gmail's 25 MB and lives on Google Drive instead.
   * It travels as a link in the mail body, like compose's Drive attachments.
   */
  driveFileId: string | null;
  webViewLink: string | null;
};

export type MailTemplate = {
  id: string;
  name: string;
  /** Subject with `{variable}` tokens intact; "" for reply-only templates. */
  subjectTemplate: string;
  /** Body HTML with tinting spans already stripped — see normalizeTemplateHtml. */
  bodyHtml: string;
  lastUsedAt: string | null;
  updatedAt: string;
  /** Files that come along when the template is used. [] before migration 0068. */
  attachments: MailTemplateAttachment[];
};

export const MAIL_TEMPLATE_NAME_MAX = 120;

/**
 * Body cap. Generous next to the prose a template actually holds, but a pasted
 * body can carry base64 `data:` images inline, and those are what would turn a
 * 2 KB row into a multi-megabyte one. The picker reads every template at once,
 * so one oversized row would slow down opening the menu for all of them.
 */
export const MAIL_TEMPLATE_BODY_MAX_BYTES = 256 * 1024;

export type MailTemplateInput = {
  name: string;
  subjectTemplate: string;
  bodyHtml: string;
};

/** Human-readable reason the input is unusable, or null when it is fine. */
export function validateMailTemplateInput(input: MailTemplateInput): string | null {
  if (!input.name.trim()) return "Give the template a name.";
  if (input.name.trim().length > MAIL_TEMPLATE_NAME_MAX) {
    return `Keep the name under ${MAIL_TEMPLATE_NAME_MAX} characters.`;
  }
  // A template with neither a subject nor a body would insert nothing, so it is
  // rejected here rather than saved as a row that does nothing when used.
  if (!input.subjectTemplate.trim() && !input.bodyHtml.trim()) {
    return "A template needs a subject or a body.";
  }
  if (new TextEncoder().encode(input.bodyHtml).length > MAIL_TEMPLATE_BODY_MAX_BYTES) {
    return "This body is too large to save as a template — try removing pasted images.";
  }
  return null;
}

/**
 * Default name for "save this draft as a template": the subject line, which is
 * what the user would have typed anyway. Falls back to a date rather than an
 * empty string so a reply template (no subject) still saves in one click.
 */
export function suggestedTemplateName(subject: string, now: Date = new Date()): string {
  const fromSubject = subject.trim().replace(/\s+/g, " ");
  if (fromSubject) return fromSubject.slice(0, MAIL_TEMPLATE_NAME_MAX);
  return `Template ${now.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
}

/** Private storage bucket holding template files. Uploads go to it via signed URLs. */
export const MAIL_TEMPLATE_ATTACHMENT_BUCKET = "mail-template-attachments";

/** "12.4 MB" — attachment sizes are always talked about in MB. */
export function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Why a file can't be stored as a template attachment, or null when it can.
 * Under the shared rule (sendsAsDriveLink) a file over Gmail's 25 MB is a Drive
 * link instead, which the editor arranges; the API checks again because the
 * client can't be trusted.
 */
export function storedAttachmentError(name: string, sizeBytes: number): string | null {
  if (!sendsAsDriveLink(sizeBytes)) return null;
  return `File size exceeded: "${name}" is ${formatMb(sizeBytes)}, over Gmail's ${formatMb(GMAIL_ATTACHMENT_MAX_BYTES)} per-file limit, so it has to be shared as a Google Drive link.`;
}

type MailTemplateRow = {
  id: string;
  name: string;
  subject_template: string | null;
  body_html: string | null;
  last_used_at: string | null;
  updated_at: string;
};

export function rowToMailTemplate(
  row: MailTemplateRow,
  attachments: MailTemplateAttachment[] = []
): MailTemplate {
  return {
    id: row.id,
    name: row.name,
    subjectTemplate: row.subject_template ?? "",
    bodyHtml: row.body_html ?? "",
    lastUsedAt: row.last_used_at,
    updatedAt: row.updated_at,
    attachments,
  };
}

export type MailTemplateAttachmentRow = {
  id: string;
  template_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  drive_file_id: string | null;
  web_view_link: string | null;
};

export const MAIL_TEMPLATE_ATTACHMENT_COLUMNS =
  "id, template_id, filename, mime_type, size_bytes, drive_file_id, web_view_link";

export function rowToMailTemplateAttachment(row: MailTemplateAttachmentRow): MailTemplateAttachment {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    // bigint arrives as a string from PostgREST once it outgrows a JS-safe int.
    sizeBytes: Number(row.size_bytes),
    driveFileId: row.drive_file_id,
    webViewLink: row.web_view_link,
  };
}

export const MAIL_TEMPLATE_COLUMNS =
  "id, name, subject_template, body_html, last_used_at, updated_at";

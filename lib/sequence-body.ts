import { mergeTemplate, normalizeMergeFieldKey, validateMergeTemplates } from "@/lib/mail-merge";

/**
 * Renders a sequence step into the exact subject/body that will be sent.
 *
 * Shared by the cron and by POST /api/sequences/[id]/preview — the preview has
 * to be byte-identical to what actually goes out, or nobody trusts it.
 */

export type StepEmailInput = {
  subjectTemplate: string;
  bodyHtml: string;
  includeSignature: boolean;
  signatureHtml?: string | null;
};

export type RecipientContext = {
  email: string;
  displayName?: string | null;
  mergeFields?: Record<string, string> | null;
};

export type BuiltStepEmail = {
  subject: string;
  html: string;
  text: string;
  /** Placeholders with no value for this recipient. Non-empty means do not send. */
  missing: string[];
};

/**
 * Merge keys available for every recipient, before their own custom fields.
 * `name` feeds mail-merge's derived first_name/last_name handling.
 */
export function buildMergeFields(recipient: RecipientContext): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(recipient.mergeFields ?? {})) {
    if (typeof value === "string") fields[normalizeMergeFieldKey(key)] = value;
  }
  fields.email = recipient.email;
  if (!fields.name?.trim() && recipient.displayName?.trim()) {
    fields.name = recipient.displayName.trim();
  }
  return fields;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildStepEmail(step: StepEmailInput, recipient: RecipientContext): BuiltStepEmail {
  const fields = buildMergeFields(recipient);

  const check = validateMergeTemplates(step.subjectTemplate, step.bodyHtml, fields);
  const missing = check.ok ? [] : check.missing;

  const subject = mergeTemplate(step.subjectTemplate, fields).trim();
  let html = mergeTemplate(step.bodyHtml, fields);

  if (step.includeSignature && step.signatureHtml?.trim()) {
    html = `${html}<br><br>${step.signatureHtml.trim()}`;
  }

  return { subject, html, text: htmlToPlainText(html), missing };
}

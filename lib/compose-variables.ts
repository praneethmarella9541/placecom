/**
 * Merge variables offered in the compose editor when mass sending is on.
 *
 * The `{key}` / `{{key}}` substitution itself is not implemented here — that
 * already lives in lib/mail-merge.ts (mergeTemplate / listPlaceholdersInTemplate)
 * and is shared with the spreadsheet-driven broadcast flow. This module only
 * defines which variables the picker offers and how a directory contact maps
 * onto the field bag mergeTemplate() consumes.
 */

import type { DirectoryContact } from "@/lib/contact-directory";
import { listPlaceholdersInTemplate, normalizeMergeFieldKey } from "@/lib/mail-merge";

export type ComposeVariable = {
  /** Merge key as it appears between braces, e.g. {company_name}. */
  key: string;
  /** Menu label. */
  label: string;
  /** Shown under the label so the user knows what will be substituted. */
  hint: string;
};

export const COMPOSE_VARIABLES: ComposeVariable[] = [
  { key: "name", label: "Name", hint: "Contact's full name" },
  { key: "company_name", label: "Company name", hint: "Company on the contact card" },
  { key: "job_title", label: "Job title", hint: "Role on the contact card" },
  { key: "phone_number", label: "Phone number", hint: "Contact's phone number" },
  { key: "last_mail_interaction", label: "Last mail interaction", hint: "Date of the most recent email exchanged" },
];

const VARIABLE_KEYS = new Set(COMPOSE_VARIABLES.map((v) => v.key));

/** Menu entries matching what the user has typed after `{`. */
export function filterComposeVariables(query: string): ComposeVariable[] {
  const q = query.trim().toLowerCase();
  if (!q) return COMPOSE_VARIABLES;
  return COMPOSE_VARIABLES.filter(
    (v) => v.key.includes(normalizeMergeFieldKey(q)) || v.label.toLowerCase().includes(q)
  );
}

/**
 * Dates render as "12 Mar 2025" rather than an ISO string — these land in
 * prose ("we last spoke on {last_mail_interaction}"), so the readable form is
 * the only sensible one. Invalid/absent dates collapse to "" so the caller's
 * missing-value handling treats them like any other empty field.
 */
function formatInteractionDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Contact card → the field bag mergeTemplate() reads.
 *
 * Aliases are included deliberately: someone who types {company} or {title}
 * out of habit rather than picking from the menu should still get a filled
 * value instead of a literal brace in a sent email.
 */
export function contactToMergeFields(contact: DirectoryContact): Record<string, string> {
  const name = contact.name?.trim() || "";
  const company = contact.company?.trim() || "";
  const title = contact.title?.trim() || "";
  const phone = contact.phone?.trim() || "";
  const lastAt = formatInteractionDate(contact.last_contacted_at);

  return {
    email: contact.email?.trim() || "",
    name,
    company_name: company,
    company,
    job_title: title,
    title,
    phone_number: phone,
    phone,
    last_mail_interaction: lastAt,
  };
}

/**
 * Auto-synced mailbox contact → merge fields.
 *
 * Only three of the five variables exist on synced_contacts (see migration
 * 0037): there is no job title or phone number in mailbox-derived data, so
 * those stay the Team Directory's job.
 */
export function syncedContactToMergeFields(row: {
  email: string;
  display_name: string | null;
  company_name: string | null;
  last_interaction_at: string | null;
}): Record<string, string> {
  const name = row.display_name?.trim() || "";
  const company = row.company_name?.trim() || "";
  const lastAt = formatInteractionDate(row.last_interaction_at);

  return {
    email: row.email.trim(),
    name,
    company_name: company,
    company,
    last_mail_interaction: lastAt,
  };
}

/**
 * Layer field bags, strongest source first. Later sources only fill gaps —
 * a Team Directory card's company always beats the domain-derived guess from
 * the mailbox sync, but a card with no company can still borrow one.
 */
export function mergeFieldSources(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const src of sources) {
    if (!src) continue;
    for (const [k, v] of Object.entries(src)) {
      if (!out[k]?.trim() && v?.trim()) out[k] = v;
    }
  }
  return out;
}

/**
 * Class marking a `{variable}` token in the compose editor so it can be
 * tinted. Editor-only decoration — stripped before preview and before send,
 * so it never reaches a recipient's inbox.
 */
export const VARIABLE_SPAN_CLASS = "cv-var";

// Deliberately tolerant of attribute order, extra classes and quote style:
// browsers rewrite markup inserted via execCommand("insertHTML"), so an exact
// string match would silently stop stripping and leak spans into sent mail.
const VARIABLE_SPAN_RE = new RegExp(
  `<span[^>]*class=["'][^"']*\\b${VARIABLE_SPAN_CLASS}\\b[^"']*["'][^>]*>([\\s\\S]*?)</span>`,
  "gi"
);

/** Remove the editor's tinting wrappers, keeping their text. */
export function stripVariableSpans(html: string): string {
  return html.replace(VARIABLE_SPAN_RE, "$1");
}

/**
 * Wrap bare `{known_variable}` tokens in the tinting span.
 *
 * Only runs over text outside tags — the negative lookahead on `<` keeps it
 * from matching inside an attribute — and only for keys we actually offer, so
 * stray braces in prose or code are left alone. Existing wrappers are removed
 * first to keep repeated passes idempotent.
 */
export function wrapVariablesInHtml(html: string): string {
  const bare = stripVariableSpans(html);
  const keys = COMPOSE_VARIABLES.map((v) => v.key).join("|");
  if (!keys) return bare;

  const re = new RegExp(`\\{(${keys})\\}(?![^<]*>)`, "g");
  return bare.replace(re, `<span class="${VARIABLE_SPAN_CLASS}">{$1}</span>`);
}

export type MissingVariableReport = {
  /** Recipient email → variable keys that resolve to an empty value for them. */
  byRecipient: Map<string, string[]>;
  /** Placeholders used in the template that aren't variables we know about. */
  unknownKeys: string[];
};

/**
 * Which variables will render blank, per recipient. Surfaced on the review
 * screen so a send with holes in it is a deliberate choice rather than a
 * surprise — we do not block sending on it.
 */
export function reportMissingVariables(
  subjectTemplate: string,
  bodyTemplate: string,
  recipients: Array<{ email: string; fields: Record<string, string> }>
): MissingVariableReport {
  const used = Array.from(
    new Set([
      ...listPlaceholdersInTemplate(subjectTemplate),
      ...listPlaceholdersInTemplate(bodyTemplate),
    ])
  );

  const unknownKeys = used.filter((k) => k !== "email" && !VARIABLE_KEYS.has(k));
  const known = used.filter((k) => k !== "email" && VARIABLE_KEYS.has(k));

  const byRecipient = new Map<string, string[]>();
  for (const r of recipients) {
    const missing = known.filter((k) => !(r.fields[k] ?? "").trim());
    if (missing.length > 0) byRecipient.set(r.email, missing);
  }

  return { byRecipient, unknownKeys };
}

/** True when the template uses at least one merge placeholder. */
export function templateUsesVariables(subjectTemplate: string, bodyTemplate: string): boolean {
  return (
    listPlaceholdersInTemplate(subjectTemplate).length > 0 ||
    listPlaceholdersInTemplate(bodyTemplate).length > 0
  );
}

/**
 * Drafts are unsent — they represent an intention, not an interaction — so
 * they never belong in a contact's or company's activity timeline.
 *
 * This has to be excluded in the search query rather than filtered afterwards:
 * ThreadListItem.labelIds deliberately strips folder-state labels (DRAFT
 * included), so a returned draft is indistinguishable from a real message by
 * the time the caller sees it.
 */
const EXCLUDE_DRAFTS = "-in:drafts";

/**
 * Gmail search query matching sent/received mail either from or to a given
 * address. `includeCc` also matches mail where the address is only cc'd —
 * off by default so existing callers (the contact/company Emails tabs, the
 * {last_mail_interaction} merge variable) keep their current behavior; the
 * CRM classifier (lib/crm-evidence.ts) opts in, since a lead cc'd on a live
 * negotiation is real signal that a from/to-only search silently drops.
 */
export function gmailAddressQuery(email: string, includeCc = false): string {
  const escaped = email.replace(/"/g, '\\"');
  const parts = [`from:"${escaped}"`, `to:"${escaped}"`];
  if (includeCc) parts.push(`cc:"${escaped}"`);
  return `(${parts.join(" OR ")}) ${EXCLUDE_DRAFTS}`;
}

/** Gmail search query matching sent/received mail from or to *any* address at a domain — company-wide, not one person. */
export function gmailDomainQuery(domain: string, includeCc = false): string {
  const escaped = domain.replace(/"/g, '\\"');
  const parts = [`from:@${escaped}`, `to:@${escaped}`];
  if (includeCc) parts.push(`cc:@${escaped}`);
  return `(${parts.join(" OR ")}) ${EXCLUDE_DRAFTS}`;
}

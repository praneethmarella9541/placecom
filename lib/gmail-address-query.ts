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

/** Gmail search query matching sent/received mail either from or to a given address. */
export function gmailAddressQuery(email: string): string {
  const escaped = email.replace(/"/g, '\\"');
  return `(from:"${escaped}" OR to:"${escaped}") ${EXCLUDE_DRAFTS}`;
}

/** Gmail search query matching sent/received mail from or to *any* address at a domain — company-wide, not one person. */
export function gmailDomainQuery(domain: string): string {
  const escaped = domain.replace(/"/g, '\\"');
  return `(from:@${escaped} OR to:@${escaped}) ${EXCLUDE_DRAFTS}`;
}

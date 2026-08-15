/**
 * Best-effort subject/snippet keyword classifier for the synced-company
 * email feed (see components/SyncedCompanyModal.tsx) — approximates what
 * Attio's own email-classification engine does, but as a plain rule table,
 * not ML. These are NOT real Gmail labels the mailbox owner applied; a
 * given email either matches one of these patterns or gets no chip at all.
 * Expect to tune the keyword lists once real traffic shows what's missed.
 */

export type EmailCategory = "Hiring" | "Scheduling" | "Receipts" | "Notifications";

export const EMAIL_CATEGORY_COLORS: Record<EmailCategory, { bg: string; fg: string; border: string }> = {
  Hiring: { bg: "#fce8e6", fg: "#c5221f", border: "#f5c6c2" },
  Scheduling: { bg: "#e8f0fe", fg: "#174ea6", border: "#aecbfa" },
  Receipts: { bg: "#e6f4ea", fg: "#137333", border: "#a8dab5" },
  Notifications: { bg: "#f1f3f4", fg: "#5f6368", border: "#dadce0" },
};

const RULES: { category: EmailCategory; pattern: RegExp }[] = [
  {
    category: "Hiring",
    pattern:
      /\b(interview|candidate|resume|cv attached|offer letter|onboarding|notice period|relieving letter|experience letter|f&f settlement|full and final|background verification|job application|recruiter|hiring)\b/i,
  },
  {
    category: "Scheduling",
    pattern: /\b(calendar invite|reschedule|schedule a (call|meeting)|meeting invite|invitation:|meet\.google\.com|zoom\.us\/j)\b/i,
  },
  {
    category: "Receipts",
    pattern: /\b(invoice|receipt|order confirmation|payment (received|confirmation|successful)|trip receipt|billing statement|subscription renew(al|ed)?)\b/i,
  },
  {
    category: "Notifications",
    pattern: /\b(no-?reply|do not reply|automated (message|notification)|this is an automatic)\b/i,
  },
];

/** Returns the first matching category, or null if nothing matches — not every email gets tagged. */
export function classifyEmail(params: { subject: string; snippet: string; from?: string }): EmailCategory | null {
  const text = `${params.subject} ${params.snippet}`;
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  if (params.from && /(no-?reply|notifications?)@/i.test(params.from)) return "Notifications";
  return null;
}

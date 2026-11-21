/**
 * Bring Your Own Mailbox — the pieces both the browser and the server need.
 * Server-side resolution lives in lib/mailbox-context.ts.
 */

/** Which mailbox the web app is working in. A request, never a grant — the server re-checks it every call. */
export const MAILBOX_COOKIE = "nucleus_mailbox";
/** Same, for the mobile app (Bearer requests carry no cookies). */
export const MAILBOX_HEADER = "x-nucleus-mailbox";

export type MailboxType = "common" | "individual";
/** What a staff member may do in the common mailbox. `none` only ever comes from an explicit admin row. */
export type MailboxAccessLevel = "none" | "view" | "reply" | "full";
export type GrantedMailboxAccess = Exclude<MailboxAccessLevel, "none">;

/**
 * What a route is about to do in the mailbox:
 *  - read:   list, open, search, download attachments
 *  - reply:  answer inside an existing conversation
 *  - send:   start a new conversation, mass send, schedule, sequences
 *  - modify: labels, archive, read/unread, star, trash, drafts outside a thread
 */
export type MailboxAction = "read" | "reply" | "send" | "modify";

export type MailboxOption = {
  /** null only when BYOM is off or not migrated: the one legacy common mailbox. */
  id: string | null;
  type: MailboxType;
  address: string | null;
  access: GrantedMailboxAccess;
};

/**
 * What to store in a row's `mailbox_id` (email_tracking, email_responses, sequences): the
 * mailbox id only for an individual mailbox, null for the common one. Null therefore always
 * means "common", whether the row predates BYOM or not, so filtering a common view is one
 * `mailbox_id is null` and an individual mailbox's rows can never surface there.
 */
export function activityMailboxId(ctx: { mailboxType: MailboxType; mailboxId: string | null }): string | null {
  return ctx.mailboxType === "individual" ? ctx.mailboxId : null;
}

const RANK: Record<GrantedMailboxAccess, number> = { view: 1, reply: 2, full: 3 };
const NEEDS: Record<MailboxAction, number> = { read: 1, reply: 2, send: 3, modify: 3 };

export function mailboxAllows(access: GrantedMailboxAccess, action: MailboxAction): boolean {
  return RANK[access] >= NEEDS[action];
}

export const MAILBOX_ACCESS_LABELS: Record<MailboxAccessLevel, string> = {
  none: "No access",
  view: "View only",
  reply: "Reply",
  full: "Full",
};

export function isMailboxAccessLevel(value: unknown): value is MailboxAccessLevel {
  return value === "none" || value === "view" || value === "reply" || value === "full";
}

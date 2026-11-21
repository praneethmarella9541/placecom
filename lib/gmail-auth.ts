import "server-only";

import { resolveMailboxGoogleAccessToken } from "@/lib/mailbox-google-access";
import { getAuthedRequest } from "@/lib/api-auth";
import { requestedMailboxId } from "@/lib/mailbox-context";
import {
  MAILBOX_ACCESS_LABELS,
  mailboxAllows,
  type GrantedMailboxAccess,
  type MailboxAction,
  type MailboxType,
} from "@/lib/mailbox-context-shared";

export type GmailAuthResult =
  | {
      ok: true;
      accessToken: string;
      userId: string;
      /** The org (admin's user id) — tenant key for contacts, CRM, sequences. */
      mailboxOwnerId: string;
      /** The Gmail account in use — pass as `mailboxKey` to Gmail/Drive calls (quota, caches). */
      mailboxKey: string;
      /** mailboxes.id; null when BYOM is off. Stamp it on rows that record mail activity. */
      mailboxId: string | null;
      mailboxType: MailboxType;
      access: GrantedMailboxAccess;
      labelScope: string[] | null;
      gmailAddress?: string;
    }
  | { ok: false; status: number; message: string };

/**
 * Resolves a Google access token for the mailbox the signed-in user may use:
 * admins use their own Google connection (stored refresh token when available);
 * staff use the linked admin's stored mailbox — or, with BYOM, the mailbox they
 * switched to (their own Gmail, or the common one with the access they were granted).
 *
 * `need` is what the route is about to do there; a caller whose access to the
 * active mailbox doesn't cover it gets a 403. Defaults to `read` for GET/HEAD and
 * `modify` for anything else — so Drive, Calendar, Sheets, Forms and Docs writes
 * in the common mailbox need full access without each route opting in. A route
 * that only knows after reading its body (send: reply vs new mail) passes the
 * lowest it could be and checks again with mailboxActionDenied. In the user's
 * own mailbox every action is allowed. Existing staff have full access, so for
 * them nothing changes.
 *
 * Pass `request` so Bearer-token requests from the mobile app are accepted.
 * Without it, only cookie-based (web) sessions work.
 */
export async function requireGmailAccessToken(
  request?: Request,
  opts?: { need?: MailboxAction }
): Promise<GmailAuthResult> {
  const authed = request ? await getAuthedRequest(request) : null;
  if (request && !authed) {
    return { ok: false, status: 401, message: "Not signed in" };
  }
  const resolved = await resolveMailboxGoogleAccessToken(authed, requestedMailboxId(request));
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, message: resolved.message };
  }
  const method = request?.method?.toUpperCase() ?? "GET";
  const need = opts?.need ?? (method === "GET" || method === "HEAD" ? "read" : "modify");
  const denied = mailboxActionDenied(resolved, need);
  if (denied) return { ok: false, status: 403, message: denied };
  return {
    ok: true,
    accessToken: resolved.accessToken,
    userId: resolved.sessionUserId,
    mailboxOwnerId: resolved.mailboxOwnerId,
    mailboxKey: resolved.mailboxKey,
    mailboxId: resolved.mailboxId,
    mailboxType: resolved.mailboxType,
    access: resolved.access,
    labelScope: resolved.labelScope,
    gmailAddress: resolved.gmailAddress,
  };
}

/**
 * Null when `access` covers `need`, else the message to send back with a 403. For routes
 * that only know what they're doing after reading the body (send: reply vs new mail).
 */
export function mailboxActionDenied(auth: { access: GrantedMailboxAccess }, need: MailboxAction): string | null {
  if (mailboxAllows(auth.access, need)) return null;
  const what = need === "reply" ? "reply" : need === "send" ? "send new mail" : "change mail";
  return `Your access to the common mailbox is "${MAILBOX_ACCESS_LABELS[auth.access]}" — ask your admin if you need to ${what} here.`;
}

/** Read/unread is part of reading; any other label change (archive, star, trash, labels) is a modification. */
export function labelChangeNeed(add: string[], remove: string[]): MailboxAction {
  return [...add, ...remove].every((l) => l === "UNREAD") ? "read" : "modify";
}

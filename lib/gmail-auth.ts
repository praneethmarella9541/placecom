import "server-only";

import { resolveMailboxGoogleAccessToken } from "@/lib/mailbox-google-access";
import { getAuthedRequest } from "@/lib/api-auth";

export type GmailAuthResult =
  | { ok: true; accessToken: string; userId: string; mailboxOwnerId: string; gmailAddress?: string }
  | { ok: false; status: number; message: string };

/**
 * Resolves a Google access token for the mailbox the signed-in user may use:
 * admins use their own Google connection (stored refresh token when available);
 * staff use the linked admin's stored mailbox.
 *
 * Pass `request` so Bearer-token requests from the mobile app are accepted.
 * Without it, only cookie-based (web) sessions work.
 */
export async function requireGmailAccessToken(request?: Request): Promise<GmailAuthResult> {
  const authed = request ? await getAuthedRequest(request) : null;
  if (request && !authed) {
    return { ok: false, status: 401, message: "Not signed in" };
  }
  const resolved = await resolveMailboxGoogleAccessToken(authed);
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, message: resolved.message };
  }
  return {
    ok: true,
    accessToken: resolved.accessToken,
    userId: resolved.sessionUserId,
    mailboxOwnerId: resolved.mailboxOwnerId,
    gmailAddress: resolved.gmailAddress,
  };
}

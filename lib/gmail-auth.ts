import "server-only";

import { resolveMailboxGoogleAccessToken } from "@/lib/mailbox-google-access";

export type GmailAuthResult =
  | { ok: true; accessToken: string; userId: string }
  | { ok: false; status: number; message: string };

/**
 * Resolves a Google access token for the mailbox the signed-in user may use:
 * admins use their own Google connection (stored refresh token when available);
 * staff use the linked admin's stored mailbox.
 */
export async function requireGmailAccessToken(): Promise<GmailAuthResult> {
  const resolved = await resolveMailboxGoogleAccessToken();
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, message: resolved.message };
  }
  return {
    ok: true,
    accessToken: resolved.accessToken,
    userId: resolved.sessionUserId,
  };
}

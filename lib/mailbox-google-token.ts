import "server-only";

import { refreshGoogleAccessToken } from "@/lib/google-oauth-refresh";
import { createServiceSupabase } from "@/lib/supabase-service";

/**
 * Gmail access tokens resolved purely from the database, with no user session.
 *
 * `lib/mailbox-google-access.ts` is the session-shaped entry point used by API
 * routes: it takes an AuthedRequest, works out which mailbox the caller belongs
 * to, and has several cookie-session fallbacks. Background work (the sequences
 * cron) has none of that — it starts from a mailbox owner id and nothing else,
 * so it gets its own narrow path here. Same DB-only refresh shape as
 * lib/google-meet-organizer.ts.
 */

const ACCESS_SKEW_MS = 120_000;

type CachedToken = { token: string; expiresAt: number; gmailAddress?: string };

const tokenCache = new Map<string, CachedToken>();

export type OwnerTokenResult =
  | { ok: true; accessToken: string; gmailAddress?: string }
  | { ok: false; code: "NO_CREDENTIALS" | "INVALID_GRANT" | "REFRESH_FAILED"; message: string };

type CredentialRow = {
  gmail_address: string | null;
  refresh_token: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
};

/** Drop cached tokens — call after an admin reconnects Google. */
export function invalidateMailboxTokenCache(ownerUserId?: string): void {
  if (ownerUserId) tokenCache.delete(ownerUserId);
  else tokenCache.clear();
}

export async function getMailboxAccessTokenForOwner(ownerUserId: string): Promise<OwnerTokenResult> {
  const now = Date.now();
  const cached = tokenCache.get(ownerUserId);
  if (cached && cached.expiresAt > now + ACCESS_SKEW_MS) {
    return { ok: true, accessToken: cached.token, gmailAddress: cached.gmailAddress };
  }

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from("google_mailbox_credentials")
    .select("gmail_address, refresh_token, access_token, access_token_expires_at")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      code: "NO_CREDENTIALS",
      message: "This mailbox has no connected Google account.",
    };
  }

  const row = data as CredentialRow;
  const gmailAddress = row.gmail_address ?? undefined;

  // Stored access token still good — no refresh round trip needed.
  if (row.access_token && row.access_token_expires_at) {
    const expiresAt = new Date(row.access_token_expires_at).getTime();
    if (!Number.isNaN(expiresAt) && expiresAt > now + ACCESS_SKEW_MS) {
      tokenCache.set(ownerUserId, { token: row.access_token, expiresAt, gmailAddress });
      return { ok: true, accessToken: row.access_token, gmailAddress };
    }
  }

  if (!row.refresh_token) {
    return {
      ok: false,
      code: "NO_CREDENTIALS",
      message: "This mailbox has no stored Google refresh token. An admin must reconnect Google.",
    };
  }

  let refreshed: { access_token: string; expires_in: number };
  try {
    refreshed = await refreshGoogleAccessToken(row.refresh_token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // invalid_grant means the refresh token was revoked or expired — retrying
    // will never help, so surface it distinctly from a transient network error.
    const revoked = /invalid_grant/i.test(message);
    return {
      ok: false,
      code: revoked ? "INVALID_GRANT" : "REFRESH_FAILED",
      message: revoked
        ? "Google access was revoked for this mailbox. An admin must sign in with Google again."
        : `Could not refresh the Google access token: ${message}`,
    };
  }

  const expiresAt = now + refreshed.expires_in * 1000;
  tokenCache.set(ownerUserId, { token: refreshed.access_token, expiresAt, gmailAddress });

  try {
    await svc
      .from("google_mailbox_credentials")
      .update({
        access_token: refreshed.access_token,
        access_token_expires_at: new Date(expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("owner_user_id", ownerUserId);
  } catch {
    /* best-effort persist — the in-memory cache still carries this run */
  }

  return { ok: true, accessToken: refreshed.access_token, gmailAddress };
}

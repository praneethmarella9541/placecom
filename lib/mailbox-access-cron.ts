import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshGoogleAccessToken } from "@/lib/google-oauth-refresh";

const ACCESS_SKEW_MS = 120_000;

export type CronMailboxTokenResult =
  | { ok: true; accessToken: string; gmailAddress?: string }
  | { ok: false; status: number; message: string };

/**
 * Resolves a Gmail access token for one specific mailbox owner, with no session/
 * cookie dependency — used by the cron-triggered sync (app/api/cron/contact-sync),
 * which runs unattended and has no logged-in user to derive an owner from.
 *
 * Deliberately separate from resolveMailboxGoogleAccessToken (lib/mailbox-google-access.ts)
 * rather than a shared code path: that function's session-derived-owner and cookie-
 * fallback logic doesn't apply here (there's no session to fall back to), and this
 * stays simpler by not needing to accommodate that.
 */
export async function getMailboxAccessTokenForOwner(
  svc: SupabaseClient,
  ownerUserId: string
): Promise<CronMailboxTokenResult> {
  const { data: row, error: rowErr } = await svc
    .from("google_mailbox_credentials")
    .select("refresh_token, access_token, access_token_expires_at, gmail_address")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (rowErr) {
    return { ok: false, status: 500, message: rowErr.message };
  }
  if (!row) {
    return { ok: false, status: 404, message: `No mailbox credentials stored for owner ${ownerUserId}.` };
  }

  const now = Date.now();
  const gmailAddress = (row.gmail_address as string | undefined) || undefined;

  if (row.access_token && row.access_token_expires_at) {
    const exp = new Date(row.access_token_expires_at as string).getTime();
    if (!Number.isNaN(exp) && exp > now + ACCESS_SKEW_MS) {
      return { ok: true, accessToken: row.access_token as string, gmailAddress };
    }
  }

  const refresh = row.refresh_token as string | undefined;
  if (!refresh) {
    return {
      ok: false,
      status: 401,
      message: "No refresh token stored for this mailbox owner — they need to sign in with Google once in the app.",
    };
  }

  try {
    const refreshed = await refreshGoogleAccessToken(refresh);
    const expiresIn = refreshed.expires_in ?? 3600;
    const expiresAt = new Date(now + expiresIn * 1000).toISOString();
    await svc
      .from("google_mailbox_credentials")
      .update({
        access_token: refreshed.access_token,
        access_token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("owner_user_id", ownerUserId);

    return { ok: true, accessToken: refreshed.access_token, gmailAddress };
  } catch (e) {
    const refreshErr = e instanceof Error ? e.message : String(e);
    const isInvalidGrant = /invalid_grant/i.test(refreshErr);
    return {
      ok: false,
      status: 401,
      message: isInvalidGrant
        ? "Google refresh token expired or revoked. Sign in with Google again to reconnect."
        : `Google token refresh failed: ${refreshErr.slice(0, 240)}`,
    };
  }
}

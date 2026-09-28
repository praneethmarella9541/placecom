import "server-only";

import { getGoogleOAuthClientId } from "@/lib/google-config";

/**
 * How much life a stored access token must have left before it is reused
 * instead of refreshed.
 *
 * This is not a clock-skew allowance — it has to outlast the longest single
 * piece of work a token gets handed to. The mailbox contact sync runs batches
 * of up to BATCH_TIME_BUDGET_MS (250s, see lib/people-mailbox-sync.ts) and
 * resolves its token once, at the start. At the previous 2 minutes, a batch
 * beginning with 3 minutes of token life passed the check and then outlived
 * its own token, and every Gmail call past the expiry came back 401 — the
 * run died with "Gmail access token expired or invalid" despite a perfectly
 * valid refresh token sitting in the row.
 *
 * 5 minutes clears the batch budget with ~50s to spare. The cost is refreshing
 * roughly every 55 minutes instead of 58; refreshes hit Google's OAuth
 * endpoint, not the Gmail API, so they spend no Gmail quota.
 *
 * Shared rather than redeclared: this used to be three separate copies (the
 * DB-only path, the session path, the cron path) that had to agree and had no
 * way of noticing when they stopped agreeing.
 */
export const ACCESS_SKEW_MS = 300_000;

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type?: string;
};

export async function refreshGoogleAccessToken(refreshToken: string): Promise<TokenResponse> {
  const clientId = getGoogleOAuthClientId();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not set (required to refresh mailbox tokens)");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google token refresh failed (${res.status}): ${text}`);
  }

  return JSON.parse(text) as TokenResponse;
}

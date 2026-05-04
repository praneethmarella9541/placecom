import "server-only";

import { getGoogleOAuthClientId } from "@/lib/google-config";

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

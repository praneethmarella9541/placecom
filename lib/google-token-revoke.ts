import "server-only";

/**
 * Revoke a Google OAuth token (refresh or access) so Google stops honouring it.
 * Best-effort: a token that is already expired or revoked comes back 400, which is fine.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

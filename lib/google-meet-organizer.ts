import "server-only";

import { refreshGoogleAccessToken } from "@/lib/google-oauth-refresh";

/** Google account whose calendar hosts all Meet links. */
export const DEFAULT_MEET_ORGANIZER_EMAIL = "g24072@astra.xlri.ac.in";

/** Always invited to every scheduled meeting. */
export const DEFAULT_MEET_ADMIN_INVITE_EMAIL = "chetangalla248@gmail.com";

const ACCESS_SKEW_MS = 120_000;
let cachedOrganizerAccess: { token: string; expiresAt: number } | null = null;

export function getMeetOrganizerCalendarId(): string {
  return (
    process.env.GOOGLE_MEET_ORGANIZER_EMAIL?.trim() || DEFAULT_MEET_ORGANIZER_EMAIL
  );
}

export function getMeetAdminInviteEmail(): string {
  return (
    process.env.GOOGLE_MEET_ORGANIZER_ADMIN_EMAIL?.trim() ||
    DEFAULT_MEET_ADMIN_INVITE_EMAIL
  );
}

/** Optional: organizer's own refresh token (npm run auth:meet-organizer). */
export function hasMeetOrganizerRefreshToken(): boolean {
  return Boolean(process.env.GOOGLE_MEET_ORGANIZER_REFRESH_TOKEN?.trim());
}

export async function getMeetOrganizerAccessToken(): Promise<string> {
  const refresh = process.env.GOOGLE_MEET_ORGANIZER_REFRESH_TOKEN?.trim();
  if (!refresh) {
    throw new Error("GOOGLE_MEET_ORGANIZER_REFRESH_TOKEN is not set");
  }

  const now = Date.now();
  if (cachedOrganizerAccess && cachedOrganizerAccess.expiresAt > now + ACCESS_SKEW_MS) {
    return cachedOrganizerAccess.token;
  }

  const refreshed = await refreshGoogleAccessToken(refresh);
  const expiresIn = refreshed.expires_in ?? 3600;
  cachedOrganizerAccess = {
    token: refreshed.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return cachedOrganizerAccess.token;
}

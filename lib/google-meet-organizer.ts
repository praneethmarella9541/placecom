import "server-only";

import { refreshGoogleAccessToken } from "@/lib/google-oauth-refresh";
import { createServiceSupabase } from "@/lib/supabase-service";

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

export function isMeetOrganizerAccountEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === getMeetOrganizerCalendarId().toLowerCase();
}

type OrganizerCredentialRow = {
  refresh_token: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
};

async function loadOrganizerCredentialsFromDb(): Promise<OrganizerCredentialRow | null> {
  try {
    const svc = createServiceSupabase();
    const { data, error } = await svc
      .from("google_mailbox_credentials")
      .select("refresh_token, access_token, access_token_expires_at")
      .ilike("gmail_address", getMeetOrganizerCalendarId())
      .maybeSingle();
    if (error || !data) return null;
    return data as OrganizerCredentialRow;
  } catch {
    return null;
  }
}

/** True when env refresh token exists or organizer signed in via app Google once. */
export async function canUseMeetOrganizerToken(): Promise<boolean> {
  if (process.env.GOOGLE_MEET_ORGANIZER_REFRESH_TOKEN?.trim()) return true;
  const row = await loadOrganizerCredentialsFromDb();
  return Boolean(row?.refresh_token || row?.access_token);
}

export async function getMeetOrganizerAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedOrganizerAccess && cachedOrganizerAccess.expiresAt > now + ACCESS_SKEW_MS) {
    return cachedOrganizerAccess.token;
  }

  const envRefresh = process.env.GOOGLE_MEET_ORGANIZER_REFRESH_TOKEN?.trim();
  const row = envRefresh ? null : await loadOrganizerCredentialsFromDb();

  if (!envRefresh && row?.access_token && row.access_token_expires_at) {
    const exp = new Date(row.access_token_expires_at).getTime();
    if (!Number.isNaN(exp) && exp > now + ACCESS_SKEW_MS) {
      return row.access_token;
    }
  }

  const refresh = envRefresh || (row?.refresh_token as string | undefined);
  if (!refresh) {
    throw new Error(
      `Meet organizer not connected. Sign in to this app with Google as ${getMeetOrganizerCalendarId()} once (no Cloud Console needed), then schedule again.`
    );
  }

  const refreshed = await refreshGoogleAccessToken(refresh);
  const expiresIn = refreshed.expires_in ?? 3600;
  cachedOrganizerAccess = {
    token: refreshed.access_token,
    expiresAt: now + expiresIn * 1000,
  };
  return cachedOrganizerAccess.token;
}

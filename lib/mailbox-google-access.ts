import "server-only";

import { refreshGoogleAccessToken } from "@/lib/google-oauth-refresh";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isMailboxMigrationNotApplied } from "@/lib/supabase-mailbox-migration";
import type { AuthedRequest } from "@/lib/api-auth";

const ACCESS_SKEW_MS = 120_000;

export type MailboxTokenResult =
  | { ok: true; accessToken: string; sessionUserId: string; mailboxOwnerId: string; gmailAddress?: string }
  | { ok: false; status: number; message: string };

/**
 * Short-lived per-user cache for the resolved token, keyed by session user id.
 * Search-suggest and similar typeahead endpoints call this on every keystroke;
 * without a cache each call pays 2 Supabase round-trips (profile + credentials
 * lookup) before it can even reach Gmail/People — this shaves that off for
 * rapid repeat calls within the same few seconds.
 */
const RESOLVED_CACHE_MS = 15_000;
const resolvedCache = new Map<string, { result: MailboxTokenResult; expiresAt: number }>();

function cacheKeyFor(authed?: AuthedRequest | null): string | null {
  return authed?.user.id ?? null;
}

/** Same behavior as pre–shared-mailbox code: Google access token from the cookie session only. */
async function legacyGoogleAccessFromSession(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string
): Promise<MailboxTokenResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.provider_token;
  if (!token) {
    return {
      ok: false,
      status: 401,
      message:
        "No Google access token in session. Sign out and sign in again (Gmail scopes required).",
    };
  }
  return { ok: true, accessToken: token, sessionUserId: userId, mailboxOwnerId: userId };
}

/**
 * Resolves a Google access token for Gmail/Drive/Calendar API calls.
 * - Admin: uses mailbox row for own user id (refresh token), else short-lived session token.
 * - Staff: uses mailbox row for `profiles.mailbox_owner_id` (the admin who connected Google).
 *
 * Accepts an optional pre-resolved auth context (for Bearer-token requests from mobile).
 * If omitted, falls back to cookie-based auth (web).
 */
export async function resolveMailboxGoogleAccessToken(
  authed?: AuthedRequest | null
): Promise<MailboxTokenResult> {
  const cacheKey = cacheKeyFor(authed);
  if (cacheKey) {
    const cached = resolvedCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
  }

  const result = await resolveMailboxGoogleAccessTokenUncached(authed);
  if (cacheKey && result.ok) {
    resolvedCache.set(cacheKey, { result, expiresAt: Date.now() + RESOLVED_CACHE_MS });
  }
  return result;
}

async function resolveMailboxGoogleAccessTokenUncached(
  authed?: AuthedRequest | null
): Promise<MailboxTokenResult> {
  let userId: string;
  // queryClient is only populated when we have a cookie session (web).
  // For Bearer requests we rely solely on the service role + DB-stored credentials.
  let queryClient: ReturnType<typeof createServerSupabaseClient> | null = null;

  if (authed) {
    userId = authed.user.id;
  } else {
    const supabase = createServerSupabaseClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user?.id) {
      return { ok: false, status: 401, message: "Not signed in" };
    }
    userId = user.id;
    queryClient = supabase;
  }

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    if (queryClient) return legacyGoogleAccessFromSession(queryClient, userId);
    return { ok: false, status: 500, message: "Service role not configured." };
  }

  const profileSource = queryClient ?? svc;
  const { data: profile, error: profileErr } = await profileSource
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", userId)
    .maybeSingle();

  if (profileErr && isMailboxMigrationNotApplied(profileErr)) {
    if (queryClient) return legacyGoogleAccessFromSession(queryClient, userId);
    return { ok: false, status: 500, message: "Mailbox migration not applied." };
  }
  if (profileErr) {
    return { ok: false, status: 500, message: profileErr.message };
  }

  if (!profile) {
    if (queryClient) return legacyGoogleAccessFromSession(queryClient, userId);
    return {
      ok: false,
      status: 403,
      message: "Profile not found — cannot resolve mailbox.",
    };
  }

  const role = profile.role as string;
  const mailboxOwnerId =
    role === "admin" ? userId : (profile.mailbox_owner_id as string | null);

  if (!mailboxOwnerId) {
    return {
      ok: false,
      status: 403,
      message:
        role !== "admin"
          ? "Your account is not linked to an admin mailbox yet."
          : "Admin profile is missing a mailbox owner id.",
    };
  }

  const { data: row, error: rowErr } = await svc
    .from("google_mailbox_credentials")
    .select("refresh_token, access_token, access_token_expires_at, gmail_address")
    .eq("owner_user_id", mailboxOwnerId)
    .maybeSingle();

  if (rowErr && isMailboxMigrationNotApplied(rowErr)) {
    if (queryClient) return legacyGoogleAccessFromSession(queryClient, userId);
    return { ok: false, status: 500, message: "Mailbox migration not applied." };
  }
  if (rowErr) {
    return { ok: false, status: 500, message: rowErr.message };
  }

  const now = Date.now();
  const gmailAddress = (row?.gmail_address as string | undefined) || undefined;

  if (row?.access_token && row.access_token_expires_at) {
    const exp = new Date(row.access_token_expires_at as string).getTime();
    if (!Number.isNaN(exp) && exp > now + ACCESS_SKEW_MS) {
      return {
        ok: true,
        accessToken: row.access_token as string,
        sessionUserId: userId,
        mailboxOwnerId,
        gmailAddress,
      };
    }
  }

  const refresh = row?.refresh_token as string | undefined;
  if (refresh) {
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
        .eq("owner_user_id", mailboxOwnerId);

      return {
        ok: true,
        accessToken: refreshed.access_token,
        sessionUserId: userId,
        mailboxOwnerId,
        gmailAddress,
      };
    } catch (e) {
      const refreshErr = e instanceof Error ? e.message : String(e);
      console.error("[mailbox-google-access] refresh failed:", refreshErr);
      // Admin self-heal (web only): if stored refresh token is stale but this admin is
      // currently signed in with Google via cookie, use their session provider_token.
      if (mailboxOwnerId === userId && queryClient) {
        const {
          data: { session },
        } = await queryClient.auth.getSession();
        const token = session?.provider_token;
        if (token) {
          return { ok: true, accessToken: token, sessionUserId: userId, mailboxOwnerId, gmailAddress };
        }
      }
      // Surface the real Google error so we can tell invalid_grant (expired/revoked)
      // from invalid_client (env mismatch) from network errors.
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

  // No refresh token stored — last-resort cookie session lookup (web admin only).
  if (mailboxOwnerId === userId && queryClient) {
    const {
      data: { session },
    } = await queryClient.auth.getSession();
    const token = session?.provider_token;
    if (token) {
      return { ok: true, accessToken: token, sessionUserId: userId, mailboxOwnerId, gmailAddress };
    }
  }

  return {
    ok: false,
    status: 401,
    message:
      "No stored mailbox credentials. The admin must sign in with Google on this app once so the mailbox can stay connected.",
  };
}

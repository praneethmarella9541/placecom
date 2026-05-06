import "server-only";

import { refreshGoogleAccessToken } from "@/lib/google-oauth-refresh";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isMailboxMigrationNotApplied } from "@/lib/supabase-mailbox-migration";

const ACCESS_SKEW_MS = 120_000;

/** Same behavior as pre–shared-mailbox code: Google access token from the Supabase session only. */
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

export type MailboxTokenResult =
  | { ok: true; accessToken: string; sessionUserId: string; mailboxOwnerId: string }
  | { ok: false; status: number; message: string };

/**
 * Resolves a Google access token for Gmail/Drive/Calendar API calls.
 * - Admin: uses mailbox row for own user id (refresh token), else short-lived session token.
 * - Staff: uses mailbox row for `profiles.mailbox_owner_id` (the admin who connected Google).
 */
export async function resolveMailboxGoogleAccessToken(): Promise<MailboxTokenResult> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user?.id) {
    return { ok: false, status: 401, message: "Not signed in" };
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr && isMailboxMigrationNotApplied(profileErr)) {
    return legacyGoogleAccessFromSession(supabase, user.id);
  }
  if (profileErr) {
    return { ok: false, status: 500, message: profileErr.message };
  }

  if (!profile) {
    return legacyGoogleAccessFromSession(supabase, user.id);
  }

  const role = profile.role as string;
  const mailboxOwnerId =
    role === "admin" ? user.id : (profile.mailbox_owner_id as string | null);

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

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return legacyGoogleAccessFromSession(supabase, user.id);
  }

  const { data: row, error: rowErr } = await svc
    .from("google_mailbox_credentials")
    .select("refresh_token, access_token, access_token_expires_at")
    .eq("owner_user_id", mailboxOwnerId)
    .maybeSingle();

  if (rowErr && isMailboxMigrationNotApplied(rowErr)) {
    return legacyGoogleAccessFromSession(supabase, user.id);
  }
  if (rowErr) {
    return { ok: false, status: 500, message: rowErr.message };
  }

  const now = Date.now();

  if (row?.access_token && row.access_token_expires_at) {
    const exp = new Date(row.access_token_expires_at as string).getTime();
    if (!Number.isNaN(exp) && exp > now + ACCESS_SKEW_MS) {
      return {
        ok: true,
        accessToken: row.access_token as string,
        sessionUserId: user.id,
        mailboxOwnerId,
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
        sessionUserId: user.id,
        mailboxOwnerId,
      };
    } catch (e) {
      console.error(e);
      return {
        ok: false,
        status: 401,
        message:
          "Mailbox Google connection expired or was revoked. The admin must sign in with Google once to reconnect.",
      };
    }
  }

  if (mailboxOwnerId === user.id) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.provider_token;
    if (token) {
      return { ok: true, accessToken: token, sessionUserId: user.id, mailboxOwnerId };
    }
  }

  return {
    ok: false,
    status: 401,
    message:
      "No stored mailbox credentials. The admin must sign in with Google on this app once so the mailbox can stay connected.",
  };
}

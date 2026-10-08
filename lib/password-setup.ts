/**
 * "Forgot password" without an old password, and made mandatory:
 *
 *  1. The login page emails a sign-in link ("Forgot password?").
 *  2. /auth/callback/exchange signs the person in and — for anything but Google —
 *     sets MUST_SET_PASSWORD_KEY on the account. It lives in app_metadata, which
 *     only the service role can write, so the person can't clear it themselves
 *     the way they could a user_metadata flag.
 *  3. middleware.ts keeps a flagged account on SET_PASSWORD_PATH: every other page
 *     redirects there and every other API call is refused until it's cleared.
 *  4. POST /api/me/set-password sets the password and clears the flag in one
 *     step — no current password needed, the emailed link already proved they own
 *     the mailbox.
 */

export const SET_PASSWORD_PATH = "/set-password";
export const SET_PASSWORD_API_PATH = "/api/me/set-password";
export const MIN_PASSWORD_LENGTH = 8;

/** app_metadata key: true while the account still has to choose a password. */
export const MUST_SET_PASSWORD_KEY = "must_set_password";

export function mustSetPassword(user: { app_metadata?: unknown } | null | undefined): boolean {
  const meta = user?.app_metadata as Record<string, unknown> | undefined;
  return meta?.[MUST_SET_PASSWORD_KEY] === true;
}

/** Shown when an admin account asks for a link — admins sign in with Google, the link is for team members. */
export const ADMIN_USES_GOOGLE_MESSAGE =
  "Admin accounts sign in with Google. Use Continue with Google instead.";

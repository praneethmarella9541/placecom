/**
 * "Forgot password" without an old password: the login page sends the normal
 * magic link, and remembers (in this browser) that the person asked because they
 * forgot their password. When the link signs them in, /auth/callback/exchange
 * sees that marker and lands them on SET_PASSWORD_PATH instead of the inbox, where
 * they choose a new password — no current password needed, the link already
 * proved they own the mailbox. The marker is a cookie rather than a redirect
 * query param so it needs no change to Supabase's allowed redirect URLs.
 */

export const SET_PASSWORD_COOKIE = "placecom_set_password";
export const SET_PASSWORD_PATH = "/set-password";
export const MIN_PASSWORD_LENGTH = 8;

/** Matches the sign-in link's own lifetime — a marker older than that is stale. */
export const SET_PASSWORD_COOKIE_MAX_AGE_S = 60 * 60;

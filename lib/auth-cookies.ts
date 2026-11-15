import type { CookieOptions } from "@supabase/ssr";

/**
 * Options for every Supabase session cookie the server writes.
 *
 * The session (access + refresh token) must not be readable from page JavaScript, so a script
 * injected into a page can't lift it (CASA 2.3.2). Nothing in the browser reads the session any
 * more: sign-in tokens are handed to /auth/establish and written by the server, sign-out goes
 * through /auth/signout, and "who am I" comes from /auth/whoami. Deletions (maxAge 0) pass
 * through this too, so a cookie that was set HttpOnly is cleared with the same attributes.
 *
 * The one cookie the browser still writes is the short-lived PKCE code verifier, set by
 * signInWithOAuth / signInWithOtp before sign-in completes. It is not a session credential and
 * the server replaces it (HttpOnly) when it finishes the code exchange.
 */
export function sessionCookieOptions(options?: CookieOptions): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: options?.path ?? "/",
  };
}

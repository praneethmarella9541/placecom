import { createClient } from "@supabase/supabase-js";

/**
 * A browser client that keeps nothing: no cookie, no localStorage, no refresh timer.
 *
 * Used for the password sign-in call so it still goes from the user's browser straight to
 * Supabase Auth (Supabase's per-IP sign-in rate limiting then sees the real client, not our
 * server). The returned tokens are passed once to /auth/establish, which stores them as
 * HttpOnly cookies, and are then dropped — see lib/client-auth.ts.
 */
export function createTransientClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

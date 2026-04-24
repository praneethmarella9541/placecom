import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase-server";

export type GmailAuthResult =
  | { ok: true; accessToken: string; userId: string }
  | { ok: false; status: number; message: string };

/**
 * Gmail calls use the Google access token stored on the Supabase session after OAuth.
 * Nothing is persisted to our DB for inbox/sync — token lives in session only.
 */
export async function requireGmailAccessToken(): Promise<GmailAuthResult> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user?.id) {
    return { ok: false, status: 401, message: "Not signed in" };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const accessToken = session?.provider_token;
  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      message:
        "No Google access token in session. Sign out and sign in again (Gmail scopes required).",
    };
  }

  return { ok: true, accessToken, userId: session.user.id };
}

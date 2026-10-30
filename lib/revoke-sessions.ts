import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase-service";

/**
 * Ends the user's other sign-ins (and their refresh tokens) after a password change, so a
 * session someone else held keeps no access once the password is new.
 *
 *  - "others": every session except the one making this request (a change from Profile).
 *  - "global": every session including this one (a reset, which ends in a fresh sign-in).
 *
 * Best effort: the password is already saved by the time this runs, so a failure is logged
 * rather than turned into an error the user would have to retry. Returns whether it worked.
 */
export async function revokeSessions(
  supabase: SupabaseClient,
  scope: "others" | "global"
): Promise<boolean> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return false;
    const { error } = await createServiceSupabase().auth.admin.signOut(session.access_token, scope);
    if (error) {
      console.error("[revoke-sessions] sign-out failed:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[revoke-sessions] sign-out threw:", e instanceof Error ? e.message : e);
    return false;
  }
}

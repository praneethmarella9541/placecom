import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserExotelLine, findUserIdForBusinessLine } from "@/lib/exotel-line";

/**
 * SMS uses the admin-assigned Exotel virtual number
 * (profiles.exotel_virtual_number). Each staff member sends from — and sees
 * threads on — the single line the admin assigned them under Admin → Team.
 */
export async function getUserSmsLine(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true; line: string } | { ok: false; error: string; status: number }> {
  const result = await getUserExotelLine(supabase, userId);
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true, line: result.data.line };
}

/** Resolve which team member owns the ExoPhone an inbound SMS was sent to. */
export async function findUserIdForSmsLine(businessE164: string): Promise<string | null> {
  return findUserIdForBusinessLine(businessE164);
}

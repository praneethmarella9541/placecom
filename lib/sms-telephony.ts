import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserWhatsAppLine, findUserIdForBusinessLine } from "@/lib/whatsapp-telephony";

/**
 * SMS uses the same admin-assigned Exotel virtual number as WhatsApp/voice
 * (profiles.exotel_virtual_number). Each staff member sends from — and sees
 * threads on — the single line the admin assigned them under Admin → Team.
 */
export async function getUserSmsLine(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true; line: string } | { ok: false; error: string; status: number }> {
  const result = await getUserWhatsAppLine(supabase, userId);
  if (!result.ok) {
    return { ok: false, error: result.error, status: result.status };
  }
  return { ok: true, line: result.data.line };
}

/** Resolve which team member owns the ExoPhone an inbound SMS was sent to. */
export async function findUserIdForSmsLine(businessE164: string): Promise<string | null> {
  return findUserIdForBusinessLine(businessE164);
}

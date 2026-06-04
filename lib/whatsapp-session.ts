import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const SESSION_MS = 24 * 60 * 60 * 1000;

/** True if this peer sent an inbound message on this business line within the last 24 hours. */
export async function hasOpenWhatsAppSession(
  supabase: SupabaseClient,
  peerE164: string,
  businessE164: string
): Promise<boolean> {
  const since = new Date(Date.now() - SESSION_MS).toISOString();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("peer_e164", peerE164)
    .eq("business_e164", businessE164)
    .eq("direction", "inbound")
    .is("deleted_at", null)
    .gte("created_at", since)
    .limit(1);

  if (error) {
    if (/business_e164/i.test(error.message ?? "")) return false;
    return false;
  }
  return (data?.length ?? 0) > 0;
}

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { peerKeysForQuery } from "@/lib/whatsapp-peer";

const SESSION_MS = 24 * 60 * 60 * 1000;

/** True if this peer sent an inbound message on this business line within the last 24 hours. */
export async function hasOpenWhatsAppSessionForPeer(
  supabase: SupabaseClient,
  peerE164: string,
  businessE164: string
): Promise<boolean> {
  const since = new Date(Date.now() - SESSION_MS).toISOString();
  const peerKeys = peerKeysForQuery(peerE164);
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .in("peer_e164", peerKeys)
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

/** @deprecated Use hasOpenWhatsAppSessionForPeer */
export async function hasOpenWhatsAppSession(
  supabase: SupabaseClient,
  peerE164: string,
  businessE164: string
): Promise<boolean> {
  return hasOpenWhatsAppSessionForPeer(supabase, peerE164, businessE164);
}

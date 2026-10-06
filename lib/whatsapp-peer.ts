import "server-only";

import { normalizePhone, phoneLookupVariants } from "@/lib/phone";

/** Canonical E.164 for a WhatsApp contact (always use for new rows). */
export function canonicalWhatsAppPeer(raw: string): string {
  return normalizePhone(raw.trim());
}

/**
 * Before the +91 fix, 10-digit Indian numbers were stored as +{digits} (e.g. +8489431508).
 * Include those aliases when loading threads so old rows still appear.
 */
export function legacyMisdialedPeerAliases(canonical: string): string[] {
  const n = canonicalWhatsAppPeer(canonical);
  if (!n.startsWith("+91") || n.length !== 13) return [];
  const local = n.slice(3);
  if (!/^[6-9]\d{9}$/.test(local)) return [];
  const mistaken = `+${local}`;
  return mistaken === n ? [] : [mistaken];
}

/** All peer_e164 values to match in Supabase for one contact. */
export function peerKeysForQuery(raw: string): string[] {
  const canonical = canonicalWhatsAppPeer(raw);
  if (!canonical) return [];
  const keys = [
    ...phoneLookupVariants(canonical),
    ...legacyMisdialedPeerAliases(canonical),
    canonical,
  ];
  return keys.filter((v, i, arr) => v && arr.indexOf(v) === i);
}

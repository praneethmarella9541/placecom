import { normalizePhone, phoneLookupVariants } from "@/lib/phone";

export type WaContactRow = {
  peer_e164: string;
  name: string;
};

/** Legacy +91 mis-dial aliases (matches server-side whatsapp-peer.ts). */
function legacyMisdialedPeerAliases(canonical: string): string[] {
  const n = normalizePhone(canonical.trim());
  if (!n.startsWith("+91") || n.length !== 13) return [];
  const local = n.slice(3);
  if (!/^[6-9]\d{9}$/.test(local)) return [];
  const mistaken = `+${local}`;
  return mistaken === n ? [] : [mistaken];
}

/** All phone variants that may appear as peer_e164 in messages or contacts. */
export function allPeerLookupKeys(raw: string): string[] {
  const canonical = normalizePhone(raw.trim());
  if (!canonical) return [];
  const keys = [
    ...phoneLookupVariants(canonical),
    ...legacyMisdialedPeerAliases(canonical),
    canonical,
  ];
  return keys.filter((v, i, arr) => v && arr.indexOf(v) === i);
}

export function canonicalPeer(raw: string): string {
  return normalizePhone(raw.trim());
}

/** Map every phone variant to its saved display name. */
export function buildContactNameMap(contacts: WaContactRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of contacts) {
    if (!c.peer_e164?.trim() || !c.name?.trim()) continue;
    for (const key of allPeerLookupKeys(c.peer_e164)) {
      map[key] = c.name.trim();
    }
  }
  return map;
}

export function resolveContactName(map: Record<string, string>, peer: string): string | undefined {
  for (const key of allPeerLookupKeys(peer)) {
    const name = map[key];
    if (name) return name;
  }
  return undefined;
}

/** Format E.164 for display: +91 98494 31508 */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (e164.startsWith("+91") && digits.length === 12) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return e164;
}

export function peerInitials(peer: string, name?: string): string {
  if (name?.trim()) return name.trim()[0].toUpperCase();
  const digits = peer.replace(/\D/g, "");
  if (digits.length >= 2) return digits.slice(-2);
  return peer.slice(0, 2).toUpperCase() || "?";
}

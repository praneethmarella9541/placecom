import { normalizePhone } from "@/lib/phone";

/**
 * Canonical peer E.164 for DB queries and session checks.
 * Must match `normalizePhone` used for Exotel send (e.g. 10-digit IN → +91…).
 */
export function normalizePeerE164(e164: string): string {
  const t = e164.trim();
  if (!t) return "";
  const viaPhone = normalizePhone(t);
  if (viaPhone.startsWith("+")) return viaPhone;
  const digits = t.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

/** Outbound send: peer is the recipient. */
export function peerForOutbound(toE164: string): string {
  return normalizePeerE164(toE164);
}

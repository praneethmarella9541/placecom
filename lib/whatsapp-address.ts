import "server-only";

import { normalizePhone } from "@/lib/phone";
import { getWhatsAppFromAddress } from "@/lib/whatsapp";

/** `whatsapp:+1555...` → `+15551234567` */
export function stripWhatsAppPrefix(addr: string): string {
  const t = addr.trim().replace(/^whatsapp:/i, "");
  if (t.startsWith("+")) return t;
  return `+${t.replace(/\D/g, "")}`;
}

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

/**
 * For an inbound Twilio webhook: From = customer, To = your business sender.
 * Peer is always the other party (contact), not your business line.
 */
export function peerFromInboundWebhook(fromAddr: string, toAddr: string): string {
  const ourRaw = getWhatsAppFromAddress();
  if (!ourRaw) {
    return normalizePeerE164(stripWhatsAppPrefix(fromAddr));
  }
  const our = normalizePeerE164(stripWhatsAppPrefix(ourRaw));
  const from = normalizePeerE164(stripWhatsAppPrefix(fromAddr));
  const to = normalizePeerE164(stripWhatsAppPrefix(toAddr));
  return from === our ? to : from;
}

/** Outbound send: peer is the recipient. */
export function peerForOutbound(toE164: string): string {
  return normalizePeerE164(toE164);
}

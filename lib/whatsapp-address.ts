import "server-only";

import { getWhatsAppFromAddress } from "@/lib/whatsapp";

/** `whatsapp:+1555...` → `+15551234567` */
export function stripWhatsAppPrefix(addr: string): string {
  const t = addr.trim().replace(/^whatsapp:/i, "");
  if (t.startsWith("+")) return t;
  return `+${t.replace(/\D/g, "")}`;
}

/** E.164 with + only digits after + */
export function normalizePeerE164(e164: string): string {
  const t = e164.trim();
  const digits = t.startsWith("+") ? t.slice(1).replace(/\D/g, "") : t.replace(/\D/g, "");
  return `+${digits}`;
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

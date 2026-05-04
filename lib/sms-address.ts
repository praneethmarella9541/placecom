import "server-only";

import { getTwilioFromNumber } from "@/lib/twilio";
import { normalizePeerE164 } from "@/lib/whatsapp-address";

/** Inbound SMS: From/To are E.164; peer is the contact (not your Twilio number). */
export function peerFromSmsWebhook(fromAddr: string, toAddr: string): string {
  const ourRaw = getTwilioFromNumber();
  if (!ourRaw) {
    return normalizePeerE164(fromAddr);
  }
  const our = normalizePeerE164(ourRaw);
  const from = normalizePeerE164(fromAddr);
  const to = normalizePeerE164(toAddr);
  return from === our ? to : from;
}

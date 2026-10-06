import "server-only";

import twilio from "twilio";
import { isExotelWhatsAppConfigured } from "@/lib/exotel-whatsapp";

type TwilioClient = ReturnType<typeof twilio>;

/** Twilio “Try WhatsApp” / sandbox shared sender (US). Override with TWILIO_WHATSAPP_FROM if your console shows a different number. */
const TWILIO_WHATSAPP_SANDBOX_DEFAULT = "whatsapp:+14155238886";

export function isWhatsAppSandbox(): boolean {
  const v = process.env.TWILIO_WHATSAPP_SANDBOX?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Twilio WhatsApp addresses use the `whatsapp:+E164` form. */
export function toWhatsAppAddress(e164: string): string {
  const t = e164.trim().replace(/\s/g, "");
  if (t.startsWith("whatsapp:")) return t;
  if (!t.startsWith("+")) {
    throw new Error("Phone number must be E.164 with leading +");
  }
  return `whatsapp:${t}`;
}

/**
 * Outbound "From" for WhatsApp API.
 * - **Sandbox (trial):** set `TWILIO_WHATSAPP_SANDBOX=true`. Uses `TWILIO_WHATSAPP_FROM` if set, else Twilio’s default sandbox `whatsapp:+14155238886`.
 * - **Production:** set `TWILIO_WHATSAPP_FROM=whatsapp:+YourApprovedNumber` or rely on `TWILIO_PHONE_NUMBER` once that number is WhatsApp-enabled.
 */
export function getWhatsAppFromAddress(): string | null {
  const explicit = process.env.TWILIO_WHATSAPP_FROM?.trim();
  if (explicit) {
    return explicit.startsWith("whatsapp:") ? explicit : `whatsapp:${explicit.replace(/^\+?/, "+")}`;
  }
  if (isWhatsAppSandbox()) {
    return TWILIO_WHATSAPP_SANDBOX_DEFAULT;
  }
  const base = process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!base) return null;
  if (!base.startsWith("+")) return null;
  return `whatsapp:${base}`;
}

/** Primary: Exotel WhatsApp API. Twilio remains available for legacy broadcast paths. */
export function isWhatsAppSendConfigured(): boolean {
  if (isExotelWhatsAppConfigured()) return true;
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && getWhatsAppFromAddress());
}

/**
 * Send a **session** message (plain body). Works when the user has messaged you within the last 24 hours,
 * or for sandbox / approved flows. For cold outreach use an approved **Content Template** (ContentSid) instead.
 */
export async function sendWhatsAppSessionMessage(
  client: TwilioClient,
  params: { toE164: string; body: string },
): Promise<{ sid: string }> {
  const from = getWhatsAppFromAddress();
  if (!from) {
    throw new Error(
      "WhatsApp sender not configured. For sandbox set TWILIO_WHATSAPP_SANDBOX=true (and optionally TWILIO_WHATSAPP_FROM). For production set TWILIO_WHATSAPP_FROM or WhatsApp-enabled TWILIO_PHONE_NUMBER.",
    );
  }
  const msg = await client.messages.create({
    from,
    to: toWhatsAppAddress(params.toE164),
    body: params.body,
  });
  return { sid: msg.sid };
}

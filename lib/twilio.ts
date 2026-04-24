import "server-only";

import twilio from "twilio";

export function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export function getTwilioFromNumber(): string {
  return process.env.TWILIO_PHONE_NUMBER?.trim() || "";
}

export function isTwilioConfigured(): boolean {
  return Boolean(getTwilioClient() && getTwilioFromNumber());
}

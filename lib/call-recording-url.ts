import "server-only";

/** Base URL Twilio should POST webhooks to (public HTTPS in production; ngrok for local dev). */
export function getTwilioWebhookBaseUrl(): string | null {
  const explicit =
    process.env.TWILIO_WEBHOOK_BASE_URL?.trim() || process.env.TWILIO_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (app) return app.replace(/\/+$/, "");
  return null;
}

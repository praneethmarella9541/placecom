import "server-only";

/** Public base URL Exotel should POST webhooks to (public HTTPS in production; ngrok for local dev). */
export function getWebhookBaseUrl(): string | null {
  const explicit = process.env.EXOTEL_WEBHOOK_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (app) return app.replace(/\/+$/, "");
  return null;
}

import "server-only";

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Public base URL Exotel should POST webhooks to (public HTTPS in production; ngrok for local dev). */
export function getWebhookBaseUrl(): string | null {
  const explicit = process.env.EXOTEL_WEBHOOK_BASE_URL?.trim();
  if (explicit) return normalizeBaseUrl(explicit);
  const app = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (app) return normalizeBaseUrl(app);
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return normalizeBaseUrl(vercel);
  return null;
}

/** Resolve public base URL from an incoming request when env vars are unset (e.g. preview deploys). */
export function getWebhookBaseUrlFromRequest(request: Request): string | null {
  const fromEnv = getWebhookBaseUrl();
  if (fromEnv) return fromEnv;

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return null;

  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host.split(",")[0].trim()}`.replace(/\/+$/, "");
}

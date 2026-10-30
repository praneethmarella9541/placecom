/**
 * Cross-site request guard for state-changing API calls.
 *
 * The session cookie is sent by the browser on any request to this site, so a page on another
 * origin could make a signed-in user's browser POST to our API. Browsers always label such a
 * request: an `Origin` header (and `Sec-Fetch-Site: cross-site`). We refuse a write when either
 * says it did not come from this site.
 *
 * Left alone on purpose:
 *  - Safe methods (GET/HEAD/OPTIONS) — they change nothing.
 *  - Bearer-token calls (the mobile app) — no ambient cookie, nothing to forge.
 *  - Requests with neither header (cron, Exotel and other webhooks, curl) — not a browser, and
 *    those routes authenticate with their own secrets rather than the session cookie.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type HeaderReader = { get(name: string): string | null };

function requestHost(headers: HeaderReader): string {
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  return (forwarded || headers.get("host") || "").toLowerCase();
}

/** Extra origins allowed to call the API from a browser, e.g. "https://app.example.com" (comma separated). */
function extraOrigins(): string[] {
  return (process.env.CSRF_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().toLowerCase().replace(/\/$/, ""))
    .filter(Boolean);
}

export function isCrossSiteWrite(method: string, headers: HeaderReader): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  if ((headers.get("authorization") ?? "").startsWith("Bearer ")) return false;

  const origin = headers.get("origin");
  if (origin) {
    let host: string;
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      return true; // "null" or garbage: a sandboxed or opaque origin
    }
    if (host === requestHost(headers)) return false;
    return !extraOrigins().includes(origin.toLowerCase().replace(/\/$/, ""));
  }

  // No Origin: fall back to Fetch Metadata. Absent means not a (modern) browser.
  const site = headers.get("sec-fetch-site");
  return site === "cross-site" || site === "same-site";
}

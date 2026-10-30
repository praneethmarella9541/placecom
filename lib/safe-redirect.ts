/**
 * A post-sign-in redirect target that stays on this site. Only a plain path is accepted:
 * "@evil.com", "//evil.com", "/\evil.com" and "https://evil.com" all fall back, because
 * `${origin}${next}` would otherwise send the browser to another host.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/inbox"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\r\n\t]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://placeholder.invalid");
    if (url.origin !== "http://placeholder.invalid") return fallback;
  } catch {
    return fallback;
  }
  return next;
}

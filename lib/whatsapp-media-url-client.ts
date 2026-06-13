/** Resolve a stored media URL into an absolute URL for outbound send / forward. */
export function resolveWhatsAppMediaUrl(url: string | null | undefined): string | null {
  const u = url?.trim();
  if (!u) return null;

  if (u.startsWith("/")) {
    const base =
      (typeof window !== "undefined" ? window.location.origin : null) ??
      process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ??
      "";
    return base ? `${base}${u}` : u;
  }

  if (
    u.startsWith("https://api.exotel.com/") ||
    u.startsWith("https://api.in.exotel.com/")
  ) {
    const base =
      (typeof window !== "undefined" ? window.location.origin : null) ??
      process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ??
      "";
    return base ? `${base}/api/whatsapp/media?url=${encodeURIComponent(u)}` : u;
  }

  if (u.startsWith("//")) return `https:${u}`;
  if (/^(https?:|data:|blob:)/i.test(u)) return u;

  const base =
    (typeof window !== "undefined" ? window.location.origin : null) ??
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") ??
    "";
  return base ? `${base}/${u}` : u;
}

/** Google CDN URLs work more reliably with an explicit size suffix. */
export function normalizeGooglePhotoUrl(url: string, size = 128): string {
  const t = url.trim();
  if (!t) return t;
  if (/=s\d+/.test(t)) return t;
  if (t.includes("googleusercontent.com")) return `${t}=s${size}-c`;
  return t;
}

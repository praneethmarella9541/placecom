/** Parse `Name <email@x.com>` or bare email. Safe for client + server. */
export function extractEmailAddress(fromHeader: string): string {
  const m = fromHeader.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  const t = fromHeader.trim();
  if (t.includes("@")) return t;
  return t;
}

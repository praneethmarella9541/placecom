/** Parse a raw RFC 2822 address list into display names (or bare emails). */
function parseAddressList(raw: string): string[] {
  if (!raw?.trim()) return [];
  const results: string[] = [];
  // Split on commas that are outside angle brackets
  const entries = raw.split(/,(?![^<]*>)/);
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    // "Display Name" <email> or Display Name <email>
    const named = trimmed.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
    if (named) {
      const name = named[1].trim();
      if (name) { results.push(name); continue; }
    }
    // Bare email
    const bare = trimmed.match(/^<([^>]+)>$/) ?? trimmed.match(/^([^\s@]+@[^\s,]+)$/);
    if (bare) { results.push(bare[1].trim()); continue; }
    // Fallback: use as-is but trim quotes
    results.push(trimmed.replace(/^"|"$/g, "").trim());
  }
  return results.filter(Boolean);
}

/** One compact line for message headers, like Gmail: "to name1, name2 · cc name3" */
export function formatMessageRecipientsLine(msg: {
  to?: string;
  cc?: string;
  bcc?: string;
}): { label: string; value: string }[] {
  const parts: { label: string; value: string }[] = [];
  const toNames  = parseAddressList(msg.to  ?? "");
  const ccNames  = parseAddressList(msg.cc  ?? "");
  const bccNames = parseAddressList(msg.bcc ?? "");
  if (toNames.length)  parts.push({ label: "to",  value: toNames.join(", ") });
  if (ccNames.length)  parts.push({ label: "cc",  value: ccNames.join(", ") });
  if (bccNames.length) parts.push({ label: "bcc", value: bccNames.join(", ") });
  return parts;
}

import { extractEmailAddress } from "@/lib/email-parse";

function splitAddressEntries(raw: string): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/,(?![^<]*>)/)
    .map((e) => e.trim())
    .filter(Boolean);
}

function emailFromEntry(trimmed: string): string {
  const named = trimmed.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (named) return named[2].trim();
  const angle = trimmed.match(/^<([^>]+)>$/);
  if (angle) return angle[1].trim();
  if (/^[^\s@]+@[^\s,]+$/.test(trimmed)) return trimmed.trim();
  return "";
}

/** Gmail-style From: `Name <email@domain.com>` */
export function formatFromHeader(from: string): string {
  if (!from?.trim()) return "Unknown";
  const email = extractEmailAddress(from);
  const match = from.match(/^"?([^"<]+)"?\s*</);
  const name = match ? match[1].trim() : "";
  if (name && email && name.toLowerCase() !== email.toLowerCase()) {
    return `${name} <${email}>`;
  }
  return email || from.trim();
}

/** Local part only (text before @) — the compact label shown inline. */
function shortLabel(trimmed: string): string {
  const email = emailFromEntry(trimmed);
  if (email.includes("@")) return email.split("@")[0] ?? email;
  return trimmed.replace(/^"|"$/g, "").trim();
}

/** Full address for the hover tooltip — local-part-only gave no way to see who it actually was. */
function fullAddress(trimmed: string): string {
  const email = emailFromEntry(trimmed);
  return email || trimmed.replace(/^"|"$/g, "").trim();
}

/**
 * One compact line for message headers: "to alice · cc bob" — each name is
 * local-part-only so the line stays short, but that means the real address
 * was nowhere in the UI. `title` carries the full comma-joined addresses so
 * hovering (same pattern as Gmail's own to/cc line) reveals who it actually
 * went to, without lengthening the line by default.
 */
export function formatMessageRecipientsLine(msg: {
  to?: string;
  cc?: string;
  bcc?: string;
}): { label: string; value: string; title: string }[] {
  const parts: { label: string; value: string; title: string }[] = [];
  const build = (raw: string | undefined) => {
    const entries = splitAddressEntries(raw ?? "");
    return { value: entries.map(shortLabel).join(", "), title: entries.map(fullAddress).join(", ") };
  };
  const to = build(msg.to);
  const cc = build(msg.cc);
  const bcc = build(msg.bcc);
  if (to.value) parts.push({ label: "to", ...to });
  if (cc.value) parts.push({ label: "cc", ...cc });
  if (bcc.value) parts.push({ label: "bcc", ...bcc });
  return parts;
}

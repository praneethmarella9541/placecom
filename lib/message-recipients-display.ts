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

/** To line: local part only (text before @). */
function formatToAddressEntry(trimmed: string): string {
  const email = emailFromEntry(trimmed);
  if (email.includes("@")) return email.split("@")[0] ?? email;
  return trimmed.replace(/^"|"$/g, "").trim();
}

function formatCcBccAddressEntry(trimmed: string): string {
  const email = emailFromEntry(trimmed);
  if (email.includes("@")) return email.split("@")[0] ?? email;
  return trimmed.replace(/^"|"$/g, "").trim();
}

/** One compact line for message headers: "to alice · cc bob" */
export function formatMessageRecipientsLine(msg: {
  to?: string;
  cc?: string;
  bcc?: string;
}): { label: string; value: string }[] {
  const parts: { label: string; value: string }[] = [];
  const to = splitAddressEntries(msg.to ?? "").map(formatToAddressEntry);
  const cc = splitAddressEntries(msg.cc ?? "").map(formatCcBccAddressEntry);
  const bcc = splitAddressEntries(msg.bcc ?? "").map(formatCcBccAddressEntry);
  if (to.length) parts.push({ label: "to", value: to.join(", ") });
  if (cc.length) parts.push({ label: "cc", value: cc.join(", ") });
  if (bcc.length) parts.push({ label: "bcc", value: bcc.join(", ") });
  return parts;
}

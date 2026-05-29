import { titleCase } from "@/lib/title-case";

/** One line for thread message headers (To / Cc / Bcc), like Gmail sent view. */
export function formatMessageRecipientsLine(msg: {
  to?: string;
  cc?: string;
  bcc?: string;
}): { label: string; value: string }[] {
  const parts: { label: string; value: string }[] = [];
  const to = msg.to?.trim();
  const cc = msg.cc?.trim();
  const bcc = msg.bcc?.trim();
  if (to) parts.push({ label: titleCase("to"), value: to });
  if (cc) parts.push({ label: titleCase("cc"), value: cc });
  if (bcc) parts.push({ label: titleCase("bcc"), value: bcc });
  return parts;
}

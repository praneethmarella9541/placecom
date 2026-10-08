/**
 * Shared rules for reading a conversation: which messages are auto-replies and
 * which are delivery-failure notices. Pure, so both the reply/bounce checks
 * (lib/email-thread-outcome.ts) and the response recorder
 * (lib/email-responses.ts) judge a message the same way.
 */

import { extractEmailAddress } from "@/lib/email-parse";

/** Auto-responders must not be mistaken for a real reply. */
export function looksAutomated(subject: string): boolean {
  return /^\s*(automatic reply|auto[- ]?reply|out of office|ooo\b)/i.test(subject);
}

export function isBounceSender(email: string): boolean {
  return /(^|\W)(mailer-daemon|postmaster)@/i.test(email);
}

/** The individual addresses in a stored recipient line ("a@x.com, Bob <b@y.com>"), lower-cased. */
export function recipientAddresses(line: string | null | undefined): string[] {
  return String(line ?? "")
    .split(/[,;]/)
    .map((part) => extractEmailAddress(part).trim().toLowerCase())
    .filter((addr) => addr.includes("@"));
}

/** Everyone an email went to — To, CC and BCC — without duplicates. */
export function allRecipients(row: { to_address?: string | null; cc_address?: string | null; bcc_address?: string | null }): string[] {
  return Array.from(
    new Set([...recipientAddresses(row.to_address), ...recipientAddresses(row.cc_address), ...recipientAddresses(row.bcc_address)])
  );
}

/**
 * A "still trying" notice rather than a failure. While a destination keeps
 * refusing, Gmail sends a Delivery Status Notification (Delay) — "not delivered
 * yet … will retry for 45 more hours" — and the email may still arrive. Only
 * the final notice means it bounced.
 */
export function isDelayNotice(message: { subject?: string | null; body?: string | null }): boolean {
  const subject = message.subject ?? "";
  if (/\(delay\)|delivery delayed/i.test(subject)) return true;
  if (/\(failure\)|undeliverable/i.test(subject)) return false;
  const text = `${subject} ${message.body ?? ""}`;
  const stillTrying =
    /not (been )?delivered yet|has not yet been delivered|hasn't been delivered yet|will (keep|continue) (trying|to try)|will retry|still trying/i.test(text);
  const gaveUp = /message not delivered(?! yet)|address not found|will not retry|permanent(ly)? fail/i.test(text);
  return stillTrying && !gaveUp;
}

import "server-only";

import { extractEmailAddress } from "@/lib/email-parse";
import { getThreadMessages } from "@/lib/gmail-inbox";

/** Auto-responders must not be mistaken for a real reply. */
function looksAutomated(subject: string): boolean {
  return /^\s*(automatic reply|auto[- ]?reply|out of office|ooo\b)/i.test(subject);
}

function isBounceSender(email: string): boolean {
  return /(^|\W)(mailer-daemon|postmaster)@/i.test(email);
}

/**
 * Looks for a reply or a bounce in a thread we started — shared by
 * lib/sequence-runner.ts (per-enrollment exit check) and the mail-merge
 * campaign report (per-recipient status), so the same heuristic answers
 * "did they reply" the same way everywhere it's asked.
 *
 * Uses the stored thread id rather than a Gmail search: it is the exact
 * conversation, so there is no risk of matching unrelated mail from the same
 * person and no dependency on Gmail's search indexing lag.
 */
export async function checkThreadForReplyOrBounce(
  accessToken: string,
  threadId: string,
  opts: {
    /** The sending mailbox's own address — messages from it are never a reply. */
    mailboxAddress: string | undefined;
    /** Epoch ms of our own first message — an inbound message before this can't be a reply to it. */
    firstSentAt: number;
    mailboxKey: string;
  }
): Promise<"replied" | "bounced" | null> {
  let messages;
  try {
    ({ messages } = await getThreadMessages(accessToken, threadId, { mailboxKey: opts.mailboxKey }));
  } catch {
    // Thread deleted or momentarily unavailable — never block the caller on this.
    return null;
  }

  const ourAddress = opts.mailboxAddress?.trim().toLowerCase();

  for (const message of messages) {
    const from = extractEmailAddress(message.from).toLowerCase();
    if (!from) continue;
    if (ourAddress && from === ourAddress) continue;
    if (isBounceSender(from)) return "bounced";

    const receivedAt = Date.parse(message.date);
    if (Number.isFinite(receivedAt) && opts.firstSentAt && receivedAt < opts.firstSentAt) continue;
    if (looksAutomated(message.subject ?? "")) continue;

    // We started this thread, so any other inbound participant is the recipient
    // replying — including from an alias or an assistant's address.
    return "replied";
  }

  return null;
}

import "server-only";

import { extractEmailAddress } from "@/lib/email-parse";
import { getThreadMessages, listThreadsPage, type ThreadMessageView } from "@/lib/gmail-inbox";
import type { GmailPriority } from "@/lib/gmail-quota";

/** Auto-responders must not be mistaken for a real reply. */
function looksAutomated(subject: string): boolean {
  return /^\s*(automatic reply|auto[- ]?reply|out of office|ooo\b)/i.test(subject);
}

function isBounceSender(email: string): boolean {
  return /(^|\W)(mailer-daemon|postmaster)@/i.test(email);
}

/**
 * Pure reply/bounce heuristic over messages the caller already has in hand —
 * no Gmail call of its own. Split out of checkThreadForReplyOrBounce so a
 * caller that fetched a thread's messages for some other reason (rendering it
 * for someone reading their mail) can reuse the exact same judgment without
 * re-fetching, which is how lib/tracking-passive-sync.ts avoids ever asking
 * Gmail a question purely to answer "did this bounce/get a reply" — see that
 * file's doc comment for the fuller reasoning.
 */
export function evaluateMessagesForOutcome(
  messages: ThreadMessageView[],
  opts: {
    /** The sending mailbox's own address — messages from it are never a reply. */
    mailboxAddress: string | undefined;
    /** Epoch ms of our own first message — an inbound message before this can't be a reply to it. */
    firstSentAt: number;
  }
): "replied" | "bounced" | null {
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

/**
 * Scans already-fetched messages (any thread the app happened to render) for
 * a bounce notice naming one of `candidateEmails` — used to catch a bounce
 * that landed in a thread other than the one that bounced (see
 * searchForBounceNotification's doc comment for why that happens) without
 * ever issuing a Gmail search for it. Only meaningful when the thread
 * actually contains a mailer-daemon/postmaster message; cheap to call
 * speculatively since it does no I/O of its own.
 */
export function findBounceMatchInMessages(
  messages: ThreadMessageView[],
  candidateEmails: string[],
  sinceMs: number
): string | null {
  const candidates = candidateEmails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (candidates.length === 0) return null;

  for (const message of messages) {
    const from = extractEmailAddress(message.from).toLowerCase();
    if (!isBounceSender(from)) continue;
    const receivedAt = Date.parse(message.date);
    if (Number.isFinite(receivedAt) && receivedAt < sinceMs) continue;
    const haystack = `${message.body || ""} ${message.subject || ""}`.toLowerCase();
    const hit = candidates.find((email) => haystack.includes(email));
    if (hit) return hit;
  }
  return null;
}

/**
 * Looks for a reply or a bounce in a thread we started — shared by
 * lib/sequence-runner.ts (per-enrollment exit check), which is a periodic
 * background cron with a specific enrollment to resolve, not a page view.
 * The mail-merge campaign report no longer calls this — see
 * lib/tracking-passive-sync.ts for how it gets replied/bounced without
 * spending a Gmail call on every report view instead.
 *
 * Uses the stored thread id rather than a Gmail search: it is the exact
 * conversation, so there is no risk of matching unrelated mail from the same
 * person and no dependency on Gmail's search indexing lag.
 */
export async function checkThreadForReplyOrBounce(
  accessToken: string,
  threadId: string,
  opts: {
    mailboxAddress: string | undefined;
    firstSentAt: number;
    mailboxKey: string;
    /** Defaults to "interactive" — a background/cron caller should opt into "batch". */
    priority?: GmailPriority;
  }
): Promise<"replied" | "bounced" | null> {
  let messages;
  try {
    ({ messages } = await getThreadMessages(accessToken, threadId, {
      mailboxKey: opts.mailboxKey,
      priority: opts.priority,
    }));
  } catch {
    // Thread deleted or momentarily unavailable — never block the caller on this.
    return null;
  }

  return evaluateMessagesForOutcome(messages, opts);
}

/**
 * Gmail's own delivery-failure notices frequently arrive as a brand-new
 * top-level thread rather than threaded into the message that bounced — the
 * mailer-daemon message doesn't carry proper References/In-Reply-To headers
 * back to it, so Gmail's own threading has nothing to group them by.
 * Confirmed in prod: a real "Address not found" bounce for a send never
 * showed up when only checking that send's own thread id (see
 * checkThreadForReplyOrBounce above). A search across the inbox for a
 * mailer-daemon/postmaster message naming this exact recipient, sent after we
 * sent to them, catches that case too.
 *
 * The search hit alone isn't trusted, though — confirmed in prod that it
 * over-matches. Gmail's quoted-phrase search on an email address isn't a
 * guaranteed exact substring match (it tokenizes on "@"/"."), so a single
 * mail-merge batch sent seconds apart to several recipients can have every
 * recipient's query land on the SAME one real bounce notification. Each
 * candidate thread's actual content is opened and checked for the exact
 * recipient address before counting it — the extra fetch only happens for
 * genuine search hits, which should be rare.
 *
 * Only called as a fallback once the thread-based check finds nothing — it
 * costs a Gmail search (plus a thread fetch per candidate) rather than a
 * single thread fetch, so it's not worth paying for every row, only the ones
 * still genuinely undecided.
 */
export async function searchForBounceNotification(
  accessToken: string,
  recipientEmail: string,
  opts: {
    sinceMs: number;
    mailboxKey: string;
    /** Defaults to "interactive" — a background/cron caller should opt into "batch". */
    priority?: GmailPriority;
  }
): Promise<boolean> {
  const since = new Date(opts.sinceMs);
  const query =
    `(from:mailer-daemon OR from:postmaster) "${recipientEmail}" ` +
    `after:${since.getFullYear()}/${since.getMonth() + 1}/${since.getDate()}`;

  let candidates;
  try {
    const page = await listThreadsPage(accessToken, {
      folder: "allmail",
      maxResults: 5,
      searchQuery: query,
      mailboxKey: opts.mailboxKey,
      priority: opts.priority,
    });
    candidates = page.threads;
  } catch {
    return false;
  }

  const needle = recipientEmail.trim().toLowerCase();
  for (const thread of candidates) {
    try {
      const { messages } = await getThreadMessages(accessToken, thread.id, {
        mailboxKey: opts.mailboxKey,
        priority: opts.priority,
      });
      const hasBounceForRecipient = messages.some((m) => {
        const from = extractEmailAddress(m.from).toLowerCase();
        if (!isBounceSender(from)) return false;
        const receivedAt = Date.parse(m.date);
        if (Number.isFinite(receivedAt) && receivedAt < opts.sinceMs) return false;
        return (m.body || "").toLowerCase().includes(needle) || (m.subject || "").toLowerCase().includes(needle);
      });
      if (hasBounceForRecipient) return true;
    } catch {
      // Unreadable candidate — try the next one rather than failing the whole check.
    }
  }
  return false;
}

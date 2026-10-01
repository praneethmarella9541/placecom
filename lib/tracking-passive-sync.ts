import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThreadMessageView } from "@/lib/gmail-inbox";
import { evaluateMessagesForOutcome, findBounceMatchInMessages } from "@/lib/email-thread-outcome";

/**
 * Updates email_tracking's replied/bounced status from a thread's messages
 * the caller already fetched for some other reason (rendering it for someone
 * reading their mail) — never issues a Gmail call of its own.
 *
 * This replaced an earlier design where the campaign report page actively
 * asked Gmail "did this bounce / get a reply" on every view (a thread fetch
 * per pending recipient, plus a Gmail search fallback for bounces). That
 * worked, but spent real Gmail quota purely to answer a UI question — this
 * project has already been burned once by a Gmail quota cut from heavy
 * testing, so paying for it on every page load wasn't worth it, and tools
 * like GMass/YAMM don't do it that way either (most run inside Gmail's own
 * tab and read what's already rendered there instead of asking an API).
 *
 * The passive equivalent: this app already calls getThreadMessages whenever
 * ANY thread is opened or hover-prefetched in the inbox (app/api/gmail/
 * threads/[id]/route.ts), for a reason that has nothing to do with tracking.
 * Piggybacking status detection onto that existing fetch means a reply or
 * bounce updates the moment someone (or the hover-prefetch) happens to look
 * at the relevant thread, at zero marginal Gmail cost. The tradeoff is
 * freshness: status is "as of the last time this thread was opened," not
 * instantly live — the right price for not spending quota on every view.
 *
 * Handles both ways a reply/bounce can show up:
 *  1. Same thread as the one we sent — direct reply, or (less commonly) a
 *     bounce threaded correctly.
 *  2. A different thread entirely — Gmail's bounce notices usually don't
 *     carry References/In-Reply-To back to the message that bounced, so they
 *     land as a new top-level thread. Any message in it from a bounce sender
 *     is checked against every still-pending recipient this user has sent to,
 *     not just whoever's thread this happens to be.
 */
export async function syncTrackingFromOpenedThread(
  supabase: SupabaseClient,
  userId: string,
  mailboxAddress: string | undefined,
  threadId: string,
  messages: ThreadMessageView[]
): Promise<void> {
  if (messages.length === 0) return;

  try {
    // Case 1: this is (or might be) the thread we sent from this campaign/sequence.
    // .limit(1) rather than .maybeSingle(): a duplicate thread id would be a
    // real anomaly, but one shouldn't turn passive bookkeeping into a thrown
    // error — take the most recent and move on.
    const { data: ownRows } = await supabase
      .from("email_tracking")
      .select("id, sent_at")
      .eq("user_id", userId)
      .eq("gmail_thread_id", threadId)
      .eq("replied", false)
      .eq("bounced", false)
      .order("sent_at", { ascending: false })
      .limit(1);
    const ownRow = ownRows?.[0];

    if (ownRow) {
      const outcome = evaluateMessagesForOutcome(messages, {
        mailboxAddress,
        firstSentAt: Date.parse(ownRow.sent_at as string) || 0,
      });
      if (outcome) {
        const now = new Date().toISOString();
        await supabase
          .from("email_tracking")
          .update(
            outcome === "replied" ? { replied: true, replied_at: now } : { bounced: true, bounced_at: now }
          )
          .eq("id", ownRow.id);
      }
    }

    // Case 2: this thread might BE a bounce notice about a different send —
    // only worth the extra lookup when something here actually looks like one.
    const looksLikeBounceThread = messages.some((m) => /mailer-daemon|postmaster/i.test(m.from));
    if (!looksLikeBounceThread) return;

    const { data: pendingRows } = await supabase
      .from("email_tracking")
      .select("id, to_address, sent_at")
      .eq("user_id", userId)
      .eq("replied", false)
      .eq("bounced", false)
      .not("gmail_thread_id", "is", null);

    if (!pendingRows || pendingRows.length === 0) return;

    const oldestSentMs = Math.min(
      ...pendingRows.map((r) => Date.parse(r.sent_at as string) || Date.now())
    );
    const matchedEmail = findBounceMatchInMessages(
      messages,
      pendingRows.map((r) => r.to_address as string),
      oldestSentMs
    );
    if (!matchedEmail) return;

    const match = pendingRows.find((r) => (r.to_address as string).toLowerCase() === matchedEmail);
    if (!match) return;

    await supabase
      .from("email_tracking")
      .update({ bounced: true, bounced_at: new Date().toISOString() })
      .eq("id", match.id);
  } catch {
    // Best-effort bookkeeping — never let this affect the thread actually loading.
  }
}

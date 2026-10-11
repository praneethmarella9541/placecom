import "server-only";

import { waitUntil } from "@vercel/functions";
import { anyClaimed, bump, pauseKey, unclaim, inUseKey, warmKey } from "@/lib/gmail-claims";
import { listThreadsPage, type MailFolder } from "@/lib/gmail-inbox";
import { MAIL_PAGE_SIZE } from "@/lib/mail-page-size";
import { hydrateThreadMetaFromStore } from "@/lib/gmail-thread-meta-store";
import { sharedBacklogMs } from "@/lib/gmail-quota";

/**
 * Background warm-up of the NEXT page. After someone is served page N, the server
 * keeps working quietly: it asks Gmail for page N+1's list and fetches the headers of
 * the threads not yet in the shared store (lib/gmail-thread-meta-store.ts), so when
 * the person clicks Older the page is already there. It never goes further than N+1.
 *
 * Safe by design:
 *  - runs on the background lane (GMAIL_BATCH_UNITS_PER_SEC, default 20) through the
 *    shared limiter, so it queues behind anything a person is waiting for;
 *  - one warm-up per page across all instances (a short claim in the database);
 *  - stops, between small groups of rows, when a person opens that page ("use" note),
 *    when Gmail has throttled recently ("pause" note), or when the rows turn out to
 *    be stored already;
 *  - skips a page when the background lane is already more than 10 s behind;
 *  - at most GMAIL_WARM_PAGES_PER_HOUR (default 20) pages per mailbox per hour;
 *  - needs migration 0074; without it (or if the database is slow) it does nothing.
 * Off with GMAIL_WARMER=0.
 */

const ENABLED = process.env.GMAIL_WARMER !== "0";
const MAX_PAGES_PER_HOUR = Math.max(1, parseInt(process.env.GMAIL_WARM_PAGES_PER_HOUR || "20", 10) || 20);
const WARM_CLAIM_MS = 120_000;
/** If the background lane is already this far behind, a warm-up would only sit in line — skip it. */
const MAX_WARM_BACKLOG_MS = 10_000;

export type WarmArgs = {
  accessToken: string;
  mailboxKey: string | undefined;
  folder: MailFolder;
  labelId?: string;
  /** The page token that opens the page to warm (the one after the page just served). */
  nextPageToken: string | undefined;
};

/** Kick off a warm-up of the next page and return immediately. Never throws. */
export function scheduleNextPageWarm(args: WarmArgs): void {
  if (!ENABLED || !args.mailboxKey || !args.nextPageToken || args.folder === "drafts") return;
  const run = warmNextPage(args).catch((e) => {
    console.warn(`[mail-warm] failed: ${e instanceof Error ? e.message : e}`);
  });
  // Keep the function alive after the response on Vercel; elsewhere the promise just runs on.
  try {
    waitUntil(run);
  } catch {
    /* not on Vercel */
  }
}

async function warmNextPage(a: WarmArgs): Promise<void> {
  const mailbox = a.mailboxKey!;
  const token = a.nextPageToken!;
  const stopKeys = [inUseKey(mailbox, token), pauseKey(mailbox)];

  // A person is on that page already, or Gmail has been throttling: don't.
  if (await anyClaimed(stopKeys)) return;
  // One warm-up per page across all instances.
  if ((await bump(warmKey(mailbox, token), WARM_CLAIM_MS)) !== 1) return;
  // Hourly budget per mailbox.
  const used = await bump(`warmcap:${mailbox}`, 3_600_000);
  if (used === null || used > MAX_PAGES_PER_HOUR) {
    await unclaim(warmKey(mailbox, token));
    return;
  }

  try {
    const backlog = await sharedBacklogMs(mailbox, "batch");
    if (backlog > MAX_WARM_BACKLOG_MS) {
      console.log(`[mail-warm] skipped — background lane is ${backlog}ms behind`);
      return;
    }
    await listThreadsPage(a.accessToken, {
      folder: a.folder as Exclude<MailFolder, "drafts">,
      maxResults: MAIL_PAGE_SIZE,
      pageToken: token,
      labelId: a.labelId,
      mailboxKey: mailbox,
      priority: "batch",
      logLabel: "mail-warm",
      shouldContinue: async (remaining) => {
        // Rows saved since (by a person's request on this page) are skipped via the cache they fill.
        await hydrateThreadMetaFromStore(mailbox, remaining);
        return !(await anyClaimed(stopKeys));
      },
    });
  } finally {
    await unclaim(warmKey(mailbox, token));
  }
}

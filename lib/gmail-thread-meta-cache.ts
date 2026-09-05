import "server-only";

import type { ThreadListItem } from "@/lib/gmail-inbox";

/**
 * Server-side cache for the per-thread header metadata a list row needs.
 *
 * `threads.list` (10 units) hands back only {id, snippet, historyId}, so every
 * row needs its own `threads.get` (another 10 units) to learn subject/from/date
 * — a 25-row page costs 260 units, and the 12 warmed folder/category views
 * re-pay that for the *same* threads, because a thread in Primary is also in
 * INBOX, IMPORTANT and All Mail.
 *
 * `historyId` is what makes this cacheable for free: Gmail bumps it on any
 * change to the thread, and `threads.list` already returns it. So a hit on
 * `${mailbox}:${threadId}:${historyId}` is guaranteed to describe the thread as
 * it exists right now — this trades no staleness for the saved unit, unlike a
 * plain TTL cache. The TTL below is only there to bound memory.
 */

/**
 * The fields a list row derives from `threads.get`. `snippet` and `historyId`
 * come from `threads.list` on every request, and `hasCalendarInvite` is
 * recomputed at assembly time because it reads the fresh snippet — so neither
 * belongs in the cached half.
 */
export type ThreadMeta = Omit<
  ThreadListItem,
  "id" | "snippet" | "historyId" | "hasCalendarInvite"
>;

type Entry = {
  meta: ThreadMeta;
  cachedAt: number;
};

const TTL_MS = 30 * 60 * 1000;
/** Roughly a few MB of small header objects — enough for many warmed mailboxes. */
const MAX_ENTRIES = 20_000;

const cache = new Map<string, Entry>();

function keyFor(mailboxKey: string, threadId: string, historyId: string): string {
  return `${mailboxKey}:${threadId}:${historyId}`;
}

function isFresh(e: Entry): boolean {
  return Date.now() - e.cachedAt < TTL_MS;
}

export function getCachedThreadMeta(
  mailboxKey: string | undefined,
  threadId: string,
  historyId: string | undefined
): ThreadMeta | undefined {
  // No historyId means we cannot prove freshness — a merged search hit, say.
  // Those must go to the network rather than risk a stale row.
  if (!mailboxKey || !historyId) return undefined;
  const k = keyFor(mailboxKey, threadId, historyId);
  const hit = cache.get(k);
  if (!hit) return undefined;
  if (!isFresh(hit)) {
    cache.delete(k);
    return undefined;
  }
  // Map preserves insertion order, so re-inserting marks this the most recently
  // used and keeps the eviction below approximately LRU rather than FIFO.
  cache.delete(k);
  cache.set(k, hit);
  return hit.meta;
}

export function setCachedThreadMeta(
  mailboxKey: string | undefined,
  threadId: string,
  historyId: string | undefined,
  meta: ThreadMeta
): void {
  if (!mailboxKey || !historyId) return;
  cache.set(keyFor(mailboxKey, threadId, historyId), { meta, cachedAt: Date.now() });
  evictIfNeeded();
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const overBy = cache.size - MAX_ENTRIES;
  let dropped = 0;
  for (const k of Array.from(cache.keys())) {
    cache.delete(k);
    if (++dropped >= overBy) break;
  }
}

/** Test/diagnostic hook. */
export function clearThreadMetaCache(): void {
  cache.clear();
}

/**
 * Session-scoped prefetch for full Gmail thread bodies (messages + HTML).
 * Mirrors Placecom mobile mail-thread-prefetch — uses ?prefetch=1 so mail is not marked read.
 */

import {
  buildMailListCacheKey,
  getMailListSessionCache,
  MAIL_LIST_PREFETCH_SPECS,
  prefetchMailListViews,
} from "@/lib/inbox-list-prefetch";
import {
  beginMailBodyPrefetchWarm,
  finishMailBodyPrefetchWarm,
  isPrefetchPausedAfterBrowserReload,
  isWorkspacePrefetchSessionComplete,
  shouldPrefetchVisibleMailList,
} from "@/lib/login-prefetch-session";
import {
  clearMailThreadSessionCache,
  hydrateMailThreadSessionCache,
  persistMailThreadSessionCache,
  type MailThreadCachePayload,
} from "@/lib/mail-thread-session-cache";

/** Set NEXT_PUBLIC_DISABLE_MAIL_THREAD_PREFETCH=1 to pause background thread fetches. */
export const MAIL_THREAD_PREFETCH_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_MAIL_THREAD_PREFETCH === "1";

const BODY_PREFETCH_CONCURRENCY = 2;
const MAIL_LIST_PAGE_SIZE = 25;
/**
 * A full-body prefetch is `threads.get?format=full` — 10 quota units each.
 * At 12 the lead batch alone spent 120 units the instant a folder changed, and
 * it ran *alongside* the rest batch, so a single tab click could put 18 calls
 * (180 units) in flight. Four is enough to keep the rows under the cursor warm
 * without the burst; the server-side quota bucket now paces anything beyond it
 * rather than letting it through and eating the minute's budget.
 */
const VISIBLE_BODY_PREFETCH_CONCURRENCY = 4;
const VISIBLE_BODY_PREFETCH_LEAD = 10;
const SESSION_THREAD_TTL_MS = 30 * 60 * 1000;

export type { MailThreadCachePayload } from "@/lib/mail-thread-session-cache";

type CacheEntry = {
  data: MailThreadCachePayload;
  fetchedAt: number;
};

const threadCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<MailThreadCachePayload | null>>();

function cacheKey(threadId: string, kind: "prefetch" | "open"): string {
  return `${kind}:${threadId}`;
}

if (typeof window !== "undefined") {
  hydrateMailThreadSessionCache().forEach((entry, threadId) => {
    threadCache.set(cacheKey(threadId, "prefetch"), entry);
  });
}

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < SESSION_THREAD_TTL_MS;
}

function gcThreadCache(): void {
  const now = Date.now();
  for (const [key, entry] of Array.from(threadCache.entries())) {
    if (now - entry.fetchedAt > SESSION_THREAD_TTL_MS) threadCache.delete(key);
  }
}

export function clearMailThreadPrefetchCache(): void {
  threadCache.clear();
  inflight.clear();
  clearMailThreadSessionCache();
}

function store(threadId: string, kind: "prefetch" | "open", data: MailThreadCachePayload): void {
  gcThreadCache();
  threadCache.set(cacheKey(threadId, kind), { data, fetchedAt: Date.now() });
  if (kind === "open") {
    threadCache.set(cacheKey(threadId, "prefetch"), { data, fetchedAt: Date.now() });
  }
  persistMailThreadSessionCache(threadId, data);
}

export function getCachedThread(threadId: string): MailThreadCachePayload | undefined {
  gcThreadCache();
  const open = threadCache.get(cacheKey(threadId, "open"));
  if (isFresh(open)) return open!.data;
  const prefetch = threadCache.get(cacheKey(threadId, "prefetch"));
  if (isFresh(prefetch)) return prefetch!.data;
  return undefined;
}

export function prefetchMailThreadIntent(threadId: string): void {
  void prefetchMailThreadOnce(threadId);
}

export function prefetchMailThreadOnce(
  threadId: string,
  opts?: { signal?: AbortSignal }
): Promise<MailThreadCachePayload | null> {
  if (MAIL_THREAD_PREFETCH_DISABLED) return Promise.resolve(null);
  if (!threadId || opts?.signal?.aborted) return Promise.resolve(null);

  const key = cacheKey(threadId, "prefetch");
  const cached = threadCache.get(key);
  if (isFresh(cached)) return Promise.resolve(cached!.data);

  const inflightKey = `prefetch:${threadId}`;
  const existing = inflight.get(inflightKey);
  if (existing) return existing;

  const promise = fetch(
    `/api/gmail/threads/${encodeURIComponent(threadId)}?prefetch=1`,
    { cache: "no-store", signal: opts?.signal }
  )
    .then(async (res) => {
      const data = (await res.json()) as MailThreadCachePayload & { error?: string };
      if (!res.ok) return null;
      const payload: MailThreadCachePayload = {
        messages: (data.messages ?? []) as Record<string, unknown>[],
        labelIds: data.labelIds ?? [],
      };
      store(threadId, "prefetch", payload);
      return payload;
    })
    .catch(() => null)
    .finally(() => inflight.delete(inflightKey));

  inflight.set(inflightKey, promise);
  return promise;
}

export function collectThreadIdsFromWarmedMailLists(perCategory = MAIL_LIST_PAGE_SIZE): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const sessionCache = getMailListSessionCache();

  for (const spec of MAIL_LIST_PREFETCH_SPECS) {
    const key = buildMailListCacheKey(spec.apiFolder, spec.labelId ?? null, "");
    const page = sessionCache.get(key);
    if (!page?.threads.length) continue;
    for (const thread of page.threads.slice(0, perCategory)) {
      if (!thread.id || seen.has(thread.id)) continue;
      seen.add(thread.id);
      ids.push(thread.id);
    }
  }
  return ids;
}

export async function prefetchMailThreadBodies(
  threadIds: readonly string[],
  opts?: {
    signal?: AbortSignal;
    concurrency?: number;
    forceRefresh?: boolean;
    append?: boolean;
    landing?: boolean;
  }
): Promise<void> {
  if (MAIL_THREAD_PREFETCH_DISABLED) return;
  if (opts?.signal?.aborted) return;
  if (!shouldPrefetchVisibleMailList(opts)) return;

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of threadIds) {
    if (!id || seen.has(id)) continue;
    if (getCachedThread(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) return;

  const lead = ids.slice(0, VISIBLE_BODY_PREFETCH_LEAD);
  const rest = ids.slice(VISIBLE_BODY_PREFETCH_LEAD);
  const leadConcurrency = Math.min(
    opts?.concurrency ?? VISIBLE_BODY_PREFETCH_CONCURRENCY,
    VISIBLE_BODY_PREFETCH_CONCURRENCY
  );

  // The rest batch now runs AFTER the lead rather than beside it. Racing them
  // doubled the real concurrency, so the "lead" rows — the ones actually under
  // the cursor — competed with rows far below the fold for the same quota.
  await prefetchMailThreadBodiesBatch(lead, {
    signal: opts?.signal,
    concurrency: leadConcurrency,
  });
  if (rest.length && !opts?.signal?.aborted) {
    await prefetchMailThreadBodiesBatch(rest, {
      signal: opts?.signal,
      concurrency: Math.max(1, Math.floor(leadConcurrency / 2)),
    });
  }
}

async function prefetchMailThreadBodiesBatch(
  threadIds: readonly string[],
  opts?: {
    signal?: AbortSignal;
    concurrency?: number;
  }
): Promise<void> {
  if (!threadIds.length) return;

  const concurrency = opts?.concurrency ?? 4;
  let idx = 0;

  const workers = Array.from({ length: Math.min(concurrency, threadIds.length) }, async () => {
    while (idx < threadIds.length && !opts?.signal?.aborted) {
      const i = idx++;
      await prefetchMailThreadOnce(threadIds[i]!, { signal: opts?.signal });
    }
  });

  await Promise.all(workers);
}

export async function prefetchMailBodiesForWarmedCategories(opts?: {
  signal?: AbortSignal;
  perCategory?: number;
  concurrency?: number;
  force?: boolean;
}): Promise<void> {
  if (MAIL_THREAD_PREFETCH_DISABLED) return;
  if (opts?.signal?.aborted) return;
  if (!beginMailBodyPrefetchWarm({ force: opts?.force })) return;

  try {
    const threadIds = collectThreadIdsFromWarmedMailLists(opts?.perCategory ?? MAIL_LIST_PAGE_SIZE);
    if (!threadIds.length) return;

    const concurrency = opts?.concurrency ?? BODY_PREFETCH_CONCURRENCY;
    let idx = 0;

    const workers = Array.from({ length: Math.min(concurrency, threadIds.length) }, async () => {
      while (idx < threadIds.length && !opts?.signal?.aborted) {
        const i = idx++;
        await prefetchMailThreadOnce(threadIds[i]!, { signal: opts?.signal });
      }
    });

    await Promise.all(workers);
  } finally {
    finishMailBodyPrefetchWarm();
  }
}

export function startMailListAndBodyPrefetchWarm(opts?: {
  skipKeys?: ReadonlySet<string>;
  listConcurrency?: number;
  bodyConcurrency?: number;
  /** Bypass session guard (inbox manual refresh). */
  force?: boolean;
}): void {
  if (!opts?.force && isPrefetchPausedAfterBrowserReload()) return;

  const listPromise = prefetchMailListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.listConcurrency ?? 3,
    force: opts?.force,
  });

  if (!opts?.force && isWorkspacePrefetchSessionComplete()) return;

  void listPromise.then(() => {
    if (!MAIL_THREAD_PREFETCH_DISABLED) {
      void prefetchMailBodiesForWarmedCategories({
        concurrency: opts?.bodyConcurrency ?? BODY_PREFETCH_CONCURRENCY,
        force: opts?.force,
      });
    }
  });
}

export async function warmMailListsThenThreadBodies(opts?: {
  skipKeys?: ReadonlySet<string>;
  listConcurrency?: number;
  bodyConcurrency?: number;
  signal?: AbortSignal;
}): Promise<void> {
  await prefetchMailListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.listConcurrency ?? 3,
    signal: opts?.signal,
  });
  if (opts?.signal?.aborted) return;
  if (!MAIL_THREAD_PREFETCH_DISABLED) {
    await prefetchMailBodiesForWarmedCategories({
      signal: opts?.signal,
      concurrency: opts?.bodyConcurrency ?? BODY_PREFETCH_CONCURRENCY,
    });
  }
}

export function rememberOpenThread(threadId: string, data: MailThreadCachePayload): void {
  store(threadId, "open", data);
}

export function rememberPrefetchThread(threadId: string, data: MailThreadCachePayload): void {
  store(threadId, "prefetch", data);
}

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

/** Set NEXT_PUBLIC_DISABLE_MAIL_THREAD_PREFETCH=1 to pause background thread fetches. */
export const MAIL_THREAD_PREFETCH_DISABLED =
  process.env.NEXT_PUBLIC_DISABLE_MAIL_THREAD_PREFETCH === "1";

const THREAD_CACHE_TTL_MS = 120_000;
const BODY_PREFETCH_CONCURRENCY = 2;
const MAIL_LIST_PAGE_SIZE = 25;

export type MailThreadCachePayload = {
  messages: Record<string, unknown>[];
  labelIds: string[];
};

type CacheEntry = {
  data: MailThreadCachePayload;
  fetchedAt: number;
};

const threadCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<MailThreadCachePayload | null>>();

function cacheKey(threadId: string, kind: "prefetch" | "open"): string {
  return `${kind}:${threadId}`;
}

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < THREAD_CACHE_TTL_MS;
}

function gcThreadCache(): void {
  const now = Date.now();
  for (const [key, entry] of Array.from(threadCache.entries())) {
    if (now - entry.fetchedAt > THREAD_CACHE_TTL_MS) threadCache.delete(key);
  }
}

export function clearMailThreadPrefetchCache(): void {
  threadCache.clear();
  inflight.clear();
}

function store(threadId: string, kind: "prefetch" | "open", data: MailThreadCachePayload): void {
  gcThreadCache();
  threadCache.set(cacheKey(threadId, kind), { data, fetchedAt: Date.now() });
  if (kind === "open") {
    threadCache.set(cacheKey(threadId, "prefetch"), { data, fetchedAt: Date.now() });
  }
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

export async function prefetchMailBodiesForWarmedCategories(opts?: {
  signal?: AbortSignal;
  perCategory?: number;
  concurrency?: number;
}): Promise<void> {
  if (MAIL_THREAD_PREFETCH_DISABLED) return;
  if (opts?.signal?.aborted) return;

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
}

export function startMailListAndBodyPrefetchWarm(opts?: {
  skipKeys?: ReadonlySet<string>;
  listConcurrency?: number;
  bodyConcurrency?: number;
}): void {
  void prefetchMailListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.listConcurrency ?? 3,
  }).then(() => {
    if (!MAIL_THREAD_PREFETCH_DISABLED) {
      void prefetchMailBodiesForWarmedCategories({
        concurrency: opts?.bodyConcurrency ?? BODY_PREFETCH_CONCURRENCY,
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

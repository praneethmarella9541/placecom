/**
 * Session-scoped SWR cache for Gmail thread lists (inbox page folder/tab views).
 * Survives navigation within the workspace so prefetched views stay warm.
 */

import {
  clearMailListSessionStorage,
  hydrateMailListSessionCache,
  persistMailListSessionCache,
  type MailListCacheSnapshot,
  type MailThreadListItem,
} from "@/lib/mail-list-session-cache";

export type { MailListCacheSnapshot, MailThreadListItem } from "@/lib/mail-list-session-cache";

export type MailListPrefetchSpec = {
  apiFolder: string;
  labelId?: string | null;
};

/** Views to warm after sign-in (empty search — matches inbox default). */
export const MAIL_LIST_PREFETCH_SPECS: readonly MailListPrefetchSpec[] = [
  /** Default Primary tab on first paint after login. */
  { apiFolder: "inbox", labelId: "CATEGORY_PERSONAL" },
  { apiFolder: "inbox", labelId: "CATEGORY_PROMOTIONS" },
  { apiFolder: "inbox", labelId: "CATEGORY_SOCIAL" },
  { apiFolder: "inbox", labelId: "CATEGORY_UPDATES" },
  { apiFolder: "inbox", labelId: "CATEGORY_FORUMS" },
  { apiFolder: "inbox", labelId: "STARRED" },
  { apiFolder: "inbox", labelId: "IMPORTANT" },
  { apiFolder: "sent" },
  { apiFolder: "drafts" },
  { apiFolder: "spam" },
  { apiFolder: "trash" },
  { apiFolder: "allmail" },
] as const;

const SESSION_CACHE = new Map<string, MailListCacheSnapshot>();
const PREFETCH_IN_FLIGHT = new Set<string>();
let cacheWriteGeneration = 0;
let activePrefetchAbort: AbortController | null = null;

if (typeof window !== "undefined") {
  hydrateMailListSessionCache().forEach((snapshot, key) => {
    SESSION_CACHE.set(key, snapshot);
  });
}

export function getMailListSessionCache(): Map<string, MailListCacheSnapshot> {
  return SESSION_CACHE;
}

export function setMailListCache(cacheKey: string, snapshot: MailListCacheSnapshot): void {
  SESSION_CACHE.set(cacheKey, snapshot);
  persistMailListSessionCache(cacheKey, snapshot);
}

/** Clear session list cache and cancel in-flight prefetches (manual refresh). */
export function clearMailListSessionCache(): void {
  SESSION_CACHE.clear();
  cacheWriteGeneration += 1;
  activePrefetchAbort?.abort();
  activePrefetchAbort = null;
  clearMailListSessionStorage();
}

/**
 * Warm all standard folder/tab views in the background.
 * Skips `skipKeys` (e.g. the tab `loadThreads` is already refreshing).
 */
export function startMailListPrefetchWarm(opts?: {
  skipKeys?: ReadonlySet<string>;
  /** Re-fetch even when a cache entry exists (after full cache clear). */
  force?: boolean;
  concurrency?: number;
}): void {
  activePrefetchAbort?.abort();
  const ac = new AbortController();
  activePrefetchAbort = ac;
  void prefetchMailListViews({
    skipKeys: opts?.skipKeys,
    signal: ac.signal,
    concurrency: opts?.concurrency ?? 3,
    force: opts?.force ?? false,
  });
}

export function buildMailListCacheKey(
  apiFolder: string,
  labelId: string | null | undefined,
  search = ""
): string {
  return `${apiFolder}|${labelId ?? ""}|${search}`;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

async function fetchMailListIntoCache(
  spec: MailListPrefetchSpec,
  cacheKey: string,
  opts: {
    signal?: AbortSignal;
    search?: string;
    writeGeneration: number;
    force?: boolean;
  }
): Promise<MailListCacheSnapshot | null> {
  if (opts.signal?.aborted) return null;
  if (!opts.force && SESSION_CACHE.has(cacheKey)) {
    return SESSION_CACHE.get(cacheKey) ?? null;
  }
  if (PREFETCH_IN_FLIGHT.has(cacheKey)) return SESSION_CACHE.get(cacheKey) ?? null;

  PREFETCH_IN_FLIGHT.add(cacheKey);
  try {
    const search = opts.search ?? "";
    const params = new URLSearchParams({
      folder: spec.apiFolder,
      maxResults: "25",
    });
    if (spec.labelId) params.set("labelId", spec.labelId);
    if (search) params.set("search", search);

    const res = await fetch(`/api/gmail/threads?${params.toString()}`, {
      cache: "no-store",
      signal: opts.signal,
    });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      threads?: MailThreadListItem[];
      nextPageToken?: string;
    };

    if (opts.signal?.aborted) return null;
    if (opts.writeGeneration !== cacheWriteGeneration) return null;
    if (!opts.force && SESSION_CACHE.has(cacheKey)) {
      return SESSION_CACHE.get(cacheKey) ?? null;
    }

    const snapshot: MailListCacheSnapshot = {
      threads: data.threads ?? [],
      nextPageToken: data.nextPageToken,
    };
    setMailListCache(cacheKey, snapshot);
    return snapshot;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return null;
    return null;
  } finally {
    PREFETCH_IN_FLIGHT.delete(cacheKey);
  }
}

/** Fetch one folder/tab view if not already cached — for pointer-down / tab intent. */
export async function prefetchMailListViewIfMissing(
  apiFolder: string,
  labelId: string | null | undefined,
  opts?: { signal?: AbortSignal; search?: string }
): Promise<MailListCacheSnapshot | null> {
  const search = opts?.search ?? "";
  const cacheKey = buildMailListCacheKey(apiFolder, labelId, search);
  const cached = SESSION_CACHE.get(cacheKey);
  if (cached?.threads.length) return cached;

  return fetchMailListIntoCache(
    { apiFolder, labelId },
    cacheKey,
    { signal: opts?.signal, search, writeGeneration: cacheWriteGeneration }
  );
}

/**
 * Quietly fetch thread lists into the session cache (never touches React state).
 * Safe to call from WorkspaceChrome on login and from inbox after first paint.
 */
export async function prefetchMailListViews(opts?: {
  skipKeys?: ReadonlySet<string>;
  signal?: AbortSignal;
  concurrency?: number;
  search?: string;
  force?: boolean;
}): Promise<void> {
  const search = opts?.search ?? "";
  const skip = opts?.skipKeys ?? new Set<string>();
  const concurrency = opts?.concurrency ?? 3;
  const force = opts?.force ?? false;
  const writeGeneration = cacheWriteGeneration;

  const queue = MAIL_LIST_PREFETCH_SPECS.map((spec) => {
    const cacheKey = buildMailListCacheKey(spec.apiFolder, spec.labelId ?? null, search);
    return { spec, cacheKey };
  }).filter(
    ({ cacheKey }) =>
      !skip.has(cacheKey) &&
      (force || !SESSION_CACHE.has(cacheKey)) &&
      !PREFETCH_IN_FLIGHT.has(cacheKey)
  );

  if (queue.length === 0) return;

  await mapWithConcurrency(queue, concurrency, async ({ spec, cacheKey }) => {
    await fetchMailListIntoCache(spec, cacheKey, {
      signal: opts?.signal,
      search,
      writeGeneration,
      force,
    });
  });
}

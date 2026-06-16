/**
 * Persists prefetched Gmail thread bodies across full page reloads (same tab).
 * Keeps opens snappy after F5 without re-running ?prefetch=1 calls.
 */

export type MailThreadCachePayload = {
  messages: Record<string, unknown>[];
  labelIds: string[];
};

const STORAGE_KEY = "placecom:mail-thread-bodies";
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_THREADS = 30;

type PersistedThread = {
  data: MailThreadCachePayload;
  fetchedAt: number;
};

type PersistedStore = Record<string, PersistedThread>;

function readStore(): PersistedStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: PersistedStore): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    pruneStore(store, Math.floor(MAX_THREADS / 2));
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      /* quota still exceeded — drop persisted cache */
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }
}

function pruneStore(store: PersistedStore, max = MAX_THREADS): void {
  const now = Date.now();
  const fresh = Object.entries(store).filter(
    ([, entry]) => now - entry.fetchedAt < SESSION_TTL_MS
  );
  fresh.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
  const kept = fresh.slice(0, max);
  for (const key of Object.keys(store)) delete store[key];
  for (const [threadId, entry] of kept) store[threadId] = entry;
}

export function hydrateMailThreadSessionCache(): Map<
  string,
  { data: MailThreadCachePayload; fetchedAt: number }
> {
  const out = new Map<string, { data: MailThreadCachePayload; fetchedAt: number }>();
  const store = readStore();
  const now = Date.now();
  let changed = false;

  for (const [threadId, entry] of Object.entries(store)) {
    if (now - entry.fetchedAt >= SESSION_TTL_MS) {
      delete store[threadId];
      changed = true;
      continue;
    }
    out.set(threadId, entry);
  }

  if (changed) writeStore(store);
  return out;
}

export function persistMailThreadSessionCache(
  threadId: string,
  data: MailThreadCachePayload
): void {
  if (!threadId) return;
  const store = readStore();
  store[threadId] = { data, fetchedAt: Date.now() };
  pruneStore(store);
  writeStore(store);
}

export function clearMailThreadSessionCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

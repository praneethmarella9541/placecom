/**
 * Persists warmed Gmail thread lists across full page reloads (same tab).
 * Keeps folder/category switches instant without re-running login warm.
 */

export type MailThreadListItem = {
  id: string;
  snippet: string;
  subject: string;
  from: string;
  date: string;
  draftId?: string;
  labelIds?: string[];
  unread?: boolean;
  starred?: boolean;
  important?: boolean;
  hasAttachments?: boolean;
  hasCalendarInvite?: boolean;
  historyId?: string;
};

export type MailListCacheSnapshot = {
  threads: MailThreadListItem[];
  nextPageToken?: string;
};

const STORAGE_KEY = "placecom:mail-list-views";
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_VIEWS = 20;

type PersistedView = MailListCacheSnapshot & { fetchedAt: number };
type PersistedStore = Record<string, PersistedView>;

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
    const entries = Object.entries(store).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
    const trimmed = Object.fromEntries(entries.slice(0, Math.floor(MAX_VIEWS / 2)));
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }
}

function pruneStore(store: PersistedStore): void {
  const now = Date.now();
  const fresh = Object.entries(store).filter(([, v]) => now - v.fetchedAt < SESSION_TTL_MS);
  fresh.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
  for (const key of Object.keys(store)) delete store[key];
  for (const [key, value] of fresh.slice(0, MAX_VIEWS)) store[key] = value;
}

export function hydrateMailListSessionCache(): Map<string, MailListCacheSnapshot> {
  const out = new Map<string, MailListCacheSnapshot>();
  const store = readStore();
  const now = Date.now();
  let changed = false;

  for (const [key, entry] of Object.entries(store)) {
    if (now - entry.fetchedAt >= SESSION_TTL_MS) {
      delete store[key];
      changed = true;
      continue;
    }
    out.set(key, { threads: entry.threads, nextPageToken: entry.nextPageToken });
  }

  if (changed) writeStore(store);
  return out;
}

export function persistMailListSessionCache(
  cacheKey: string,
  snapshot: MailListCacheSnapshot
): void {
  if (!cacheKey) return;
  const store = readStore();
  store[cacheKey] = { ...snapshot, fetchedAt: Date.now() };
  pruneStore(store);
  writeStore(store);
}

export function clearMailListSessionStorage(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

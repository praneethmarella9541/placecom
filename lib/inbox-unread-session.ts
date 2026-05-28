/** Session-persisted Inbox unread count so tab switches don't reset to stale Gmail API values. */
const KEY = "placecom-inbox-unread";

export function readSessionInboxUnread(): number | null {
  if (typeof window === "undefined") return null;
  const n = parseInt(sessionStorage.getItem(KEY) ?? "", 10);
  return Number.isNaN(n) ? null : Math.max(0, n);
}

export function writeSessionInboxUnread(unread: number) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, String(Math.max(0, unread)));
}

/**
 * Merge server INBOX unread with the session value. When the API is stale
 * (still 201 after reads), keep the lower session count. When new mail
 * arrives (server > session), adopt the server count.
 */
export function mergeInboxUnread(serverUnread: number, sessionUnread: number | null): number {
  if (sessionUnread === null) return serverUnread;
  if (sessionUnread < serverUnread) return sessionUnread;
  return serverUnread;
}

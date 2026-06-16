/**
 * Session flags survive full page reload within the same tab (sessionStorage).
 * Written at warm *start* so refresh mid-warm does not re-trigger bulk fetches.
 * Cleared on sign-out.
 */

const WORKSPACE_KEY = "placecom:workspace-prefetch-done";
const MAIL_BODY_KEY = "placecom:mail-body-prefetch-done";

let workspaceWarming = false;
let mailBodyWarming = false;

function readFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

export function isWorkspacePrefetchSessionComplete(): boolean {
  return readFlag(WORKSPACE_KEY);
}

export function isMailBodyPrefetchSessionComplete(): boolean {
  return readFlag(MAIL_BODY_KEY);
}

export function clearWorkspacePrefetchSession(): void {
  workspaceWarming = false;
  mailBodyWarming = false;
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(WORKSPACE_KEY);
    sessionStorage.removeItem(MAIL_BODY_KEY);
  } catch {
    /* ignore */
  }
}

/** Full login warm (mail lists + bodies, drive, WhatsApp, calendar, forms). */
export function beginWorkspacePrefetchWarm(opts?: { force?: boolean }): boolean {
  if (opts?.force) {
    clearWorkspacePrefetchSession();
    workspaceWarming = true;
    writeFlag(WORKSPACE_KEY);
    writeFlag(MAIL_BODY_KEY);
    return true;
  }
  if (workspaceWarming || readFlag(WORKSPACE_KEY)) return false;
  workspaceWarming = true;
  writeFlag(WORKSPACE_KEY);
  writeFlag(MAIL_BODY_KEY);
  return true;
}

export function finishWorkspacePrefetchWarm(): void {
  workspaceWarming = false;
}

export function abortWorkspacePrefetchWarm(): void {
  workspaceWarming = false;
}

/** Bulk Gmail thread body prefetch (`?prefetch=1`) — also set when workspace warm starts. */
export function beginMailBodyPrefetchWarm(opts?: { force?: boolean }): boolean {
  if (opts?.force) {
    mailBodyWarming = false;
    if (typeof window !== "undefined") {
      try {
        sessionStorage.removeItem(MAIL_BODY_KEY);
      } catch {
        /* ignore */
      }
    }
    mailBodyWarming = true;
    writeFlag(MAIL_BODY_KEY);
    return true;
  }
  if (mailBodyWarming || readFlag(MAIL_BODY_KEY)) return false;
  mailBodyWarming = true;
  writeFlag(MAIL_BODY_KEY);
  return true;
}

export function finishMailBodyPrefetchWarm(): void {
  mailBodyWarming = false;
}

function isBrowserReload(): boolean {
  if (typeof window === "undefined") return false;
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === "reload";
}

/** After F5 in a warmed tab: rely on sessionStorage caches, skip background API prefetch. */
export function isPrefetchPausedAfterBrowserReload(): boolean {
  return isWorkspacePrefetchSessionComplete() && isBrowserReload();
}

/**
 * Background thread-body prefetch for the visible list.
 * `landing` = user is on this folder/tab page (always warm, including after F5).
 * Bulk all-category warm omits `landing` and is skipped after F5.
 */
export function shouldPrefetchVisibleMailList(opts?: {
  forceRefresh?: boolean;
  append?: boolean;
  landing?: boolean;
}): boolean {
  if (opts?.forceRefresh || opts?.append || opts?.landing) return true;
  if (!isWorkspacePrefetchSessionComplete()) return true;
  return !isBrowserReload();
}

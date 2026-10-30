"use client";

import { clearAnalyticsPrefetch } from "@/lib/analytics-prefetch";
import { clearMailListSessionCache } from "@/lib/inbox-list-prefetch";
import { clearMeMailboxCache } from "@/lib/use-me-mailbox";
import { clearSecondaryFeaturePrefetchCache } from "@/lib/workspace-feature-prefetch";

/**
 * Wipes what this browser cached about the signed-in user: mail lists and thread bodies, contact
 * and team prefetches, the unread count and the cached profile. Call it before `auth.signOut()`
 * so the next person on this browser starts clean. Layout preferences (sidebar width, drive sort
 * order) hold nothing about the user and are left alone.
 */
export function clearClientData(): void {
  clearSecondaryFeaturePrefetchCache();
  clearMailListSessionCache();
  clearAnalyticsPrefetch();
  clearMeMailboxCache();
  // Everything this app keeps in sessionStorage is a cache of the user's own data.
  try {
    window.sessionStorage.clear();
  } catch {
    /* storage unavailable (private mode, blocked) */
  }
}

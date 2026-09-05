"use client";

import { useSyncExternalStore } from "react";
import type { ConnectionStrengthSettings, EmailConnectionStrength } from "@/lib/email-connection-strength";
import { subscribeContactSync, getContactSyncSnapshot } from "@/lib/contact-sync-store";

export type SyncedContactRow = {
  id: string;
  email: string;
  display_name: string | null;
  domain: string | null;
  company_name: string | null;
  last_interaction_at: string | null;
  connection_strength: EmailConnectionStrength | null;
  message_count_90d: number;
  message_count_total: number;
  synced_at: string | null;
};

type StrengthSettingsCache = { settings: ConnectionStrengthSettings; isDefault: boolean };

/**
 * Module-level cache + pub-sub for the auto-synced-from-mail People list (and
 * its connection-strength settings) — same shape as lib/contact-sync-store.ts,
 * so components read it with useSyncExternalStore instead of re-deriving their
 * own loading/contacts state from a fetch they each own.
 *
 * Previously this data only got fetched the first time SyncedContactsSection
 * mounted — cheap for a session that never opens that section, but it means
 * the *first* open always shows a "Loading…" while ~2,500 rows come down,
 * every session. warmSyncedContacts() below starts that fetch as soon as the
 * Contacts page mounts (see ContactDirectory), in the background, so by the
 * time someone actually expands the section it's usually already there.
 *
 * Deliberately NOT part of the eager login-time prefetch chain
 * (lib/workspace-feature-prefetch.ts) — that chain runs before the user has
 * even reached a page, and warming ~2,500 rows nobody may look at this
 * session isn't worth delaying Mail/Drive/WhatsApp for. This instead fires
 * once the Contacts page itself is the thing being looked at.
 */
let contactsCache: SyncedContactRow[] | null = null;
let strengthSettingsCache: StrengthSettingsCache | null = null;
let warmPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSyncedContactsCache(): SyncedContactRow[] | null {
  return contactsCache;
}

export function setSyncedContactsCache(rows: SyncedContactRow[]): void {
  contactsCache = rows;
  notify();
}

export function getStrengthSettingsCache(): StrengthSettingsCache | null {
  return strengthSettingsCache;
}

export function setStrengthSettingsCache(value: StrengthSettingsCache): void {
  strengthSettingsCache = value;
  notify();
}

/** Reactive read of the People cache — null until warmed/loaded. */
export function useSyncedContactsCache(): SyncedContactRow[] | null {
  return useSyncExternalStore(subscribe, getSyncedContactsCache, () => null);
}

/** Reactive read of the connection-strength settings cache. */
export function useStrengthSettingsCache(): StrengthSettingsCache | null {
  return useSyncExternalStore(subscribe, getStrengthSettingsCache, () => null);
}

/**
 * Fetches the People list + connection-strength settings and writes them into
 * the cache once the response lands. Does NOT touch the cache before that —
 * `useSyncedContactsCache()` keeps returning whatever was already there for
 * the whole fetch, so a page already showing the list never flashes back to
 * a loading skeleton while this runs in the background. The empty-cache case
 * (nothing to show yet) is exactly what `contactsCache === null` already
 * means to callers, so the "first load" skeleton still works correctly.
 */
function fetchSyncedContacts(): Promise<void> {
  if (warmPromise) return warmPromise;
  warmPromise = (async () => {
    try {
      const [contactsRes, settingsRes] = await Promise.all([
        fetch("/api/synced-contacts"),
        strengthSettingsCache ? null : fetch("/api/user-settings/connection-strength"),
      ]);

      const contactsJson = await contactsRes.json().catch(() => ({}));
      if (contactsRes.ok) setSyncedContactsCache(contactsJson.contacts ?? []);

      if (settingsRes) {
        const settingsJson = await settingsRes.json().catch(() => ({}));
        if (settingsRes.ok) {
          setStrengthSettingsCache({ settings: settingsJson.settings, isDefault: settingsJson.isDefault });
        }
      }
    } catch {
      // Best-effort — SyncedContactsSection falls back to fetching itself on mount if this failed.
    } finally {
      warmPromise = null;
    }
  })();
  return warmPromise;
}

/**
 * Kicks off the initial fetch if nothing has loaded or is loading yet — safe
 * to call from every render/mount that wants the data hot, including
 * multiple times. A no-op once the cache is populated; see refreshSyncedContacts
 * for "reload what's already showing".
 */
export function warmSyncedContacts(): void {
  if (contactsCache !== null || warmPromise) return;
  void fetchSyncedContacts();
}

let syncInvalidationArmed = false;

/**
 * Watches the shared contact-sync store (lib/contact-sync-store.ts) for a run
 * finishing and re-fetches the People list — at module scope, not inside a
 * React effect, so this keeps working even while the Contacts page's synced
 * section is collapsed/unmounted. Idempotent: safe to call from every mount.
 *
 * Deliberately does NOT null the cache first (see fetchSyncedContacts) — an
 * earlier version did, which meant an auto-resumed background sync finishing
 * while the section happened to be open blanked an already-populated list
 * back to a loading skeleton for no reason a user watching the page could see.
 */
export function armSyncedContactsInvalidation(): void {
  if (syncInvalidationArmed) return;
  syncInvalidationArmed = true;
  let wasRunning = false;
  subscribeContactSync(() => {
    const status = getContactSyncSnapshot().status;
    if (status === "running") {
      wasRunning = true;
    } else if (wasRunning && status !== "loading") {
      wasRunning = false;
      void fetchSyncedContacts();
    }
  });
}

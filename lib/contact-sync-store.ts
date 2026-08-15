"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny module-level shared store for the background contact-mailbox-sync loop.
 * `components/ContactSyncStatus.tsx` (mounted once in AppShell, survives client-side
 * navigation) owns the actual polling/batch loop; `components/SyncedContactsSection.tsx`
 * on the Contacts page just reads this same state and can request a run — so a sync
 * kicked off from one page keeps going, and shows the same progress, from any page.
 */

export type ContactSyncSnapshot = {
  status: "loading" | "idle" | "running" | "paused" | "error";
  phase: "backfill" | "incremental" | null;
  messagesScanned: number;
  contactsFound: number;
  summary: string | null;
  error: string | null;
};

const initialSnapshot: ContactSyncSnapshot = {
  status: "loading",
  phase: null,
  messagesScanned: 0,
  contactsFound: 0,
  summary: null,
  error: null,
};

let snapshot: ContactSyncSnapshot = initialSnapshot;
let runRequested = false;
let stopRequested = false;
const listeners = new Set<() => void>();

export function getContactSyncSnapshot(): ContactSyncSnapshot {
  return snapshot;
}

export function setContactSyncSnapshot(patch: Partial<ContactSyncSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((notify) => notify());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read the shared sync state; re-renders whenever ContactSyncStatus's loop updates it. */
export function useContactSyncSnapshot(): ContactSyncSnapshot {
  return useSyncExternalStore(subscribe, getContactSyncSnapshot, () => initialSnapshot);
}

/** Called from the "Sync from mailbox" button — ContactSyncStatus's loop picks this up. */
export function requestContactSyncRun(): void {
  runRequested = true;
}

/** ContactSyncStatus calls this each tick to see if a run was requested; clears the flag. */
export function consumeContactSyncRunRequest(): boolean {
  if (!runRequested) return false;
  runRequested = false;
  return true;
}

/** Called from the "Stop syncing" control — ContactSyncStatus's loop checks this between batches. */
export function requestContactSyncStop(): void {
  stopRequested = true;
}

/** ContactSyncStatus calls this between batches to see if a stop was requested; clears the flag. */
export function consumeContactSyncStopRequest(): boolean {
  if (!stopRequested) return false;
  stopRequested = false;
  return true;
}

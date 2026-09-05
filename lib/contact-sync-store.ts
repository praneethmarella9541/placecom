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
  /**
   * Gmail's estimate of total messages this backfill has to scan, or null when
   * unknown (incremental runs, or before the first page comes back). Only ever a
   * denominator for display — never treated as exact.
   */
  messagesTotalEstimate: number | null;
  summary: string | null;
  error: string | null;
  /**
   * Transient in-run message (e.g. waiting out a Gmail quota window). Distinct
   * from `error` — the sync is healthy and will continue on its own — and from
   * `summary`, which describes a finished run.
   */
  notice: string | null;
};

const initialSnapshot: ContactSyncSnapshot = {
  status: "loading",
  phase: null,
  messagesScanned: 0,
  contactsFound: 0,
  messagesTotalEstimate: null,
  summary: null,
  error: null,
  notice: null,
};

let snapshot: ContactSyncSnapshot = initialSnapshot;
let runRequested = false;
let stopRequested = false;
const listeners = new Set<() => void>();

/**
 * What the user just asked for, and how long to trust it over the server.
 *
 * A click updates the snapshot immediately, but the server row only catches up
 * once the request lands — and the POST does an auth + Google token refresh
 * first, so that can take a second or two. Status polls run every 3s, so one
 * landing inside that window would apply the row's pre-click status and visibly
 * revert the button. While an intent is pending, polls contribute progress
 * numbers but must not overwrite status.
 */
let intent: { status: "running" | "paused"; untilMs: number } | null = null;
const INTENT_TRUST_MS = 8000;

function markIntent(status: "running" | "paused"): void {
  intent = { status, untilMs: Date.now() + INTENT_TRUST_MS };
}

/** Null once the server has confirmed the intent or the trust window has passed. */
export function getContactSyncIntent(): { status: "running" | "paused" } | null {
  if (!intent) return null;
  if (Date.now() > intent.untilMs) {
    intent = null;
    return null;
  }
  return { status: intent.status };
}

/** Called once a status row shows the intended state — no need to keep guarding. */
export function clearContactSyncIntent(): void {
  intent = null;
}

export function getContactSyncSnapshot(): ContactSyncSnapshot {
  return snapshot;
}

export function setContactSyncSnapshot(patch: Partial<ContactSyncSnapshot>): void {
  // Bail before allocating if nothing actually differs. useSyncExternalStore
  // compares snapshots by identity, so handing it a fresh object for an
  // unchanged state forces a re-render — and the 3s status poll writes the same
  // values over and over, which made that a steady drip of pointless renders.
  let changed = false;
  for (const key of Object.keys(patch) as (keyof ContactSyncSnapshot)[]) {
    if (patch[key] !== snapshot[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;

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

/**
 * Subscribe to snapshot changes outside React. ContactSyncStatus uses this to
 * start driving the moment a run is requested — the request used to be delivered
 * only by its 1.5s polling tick, so a button click had no observable effect on
 * the UI until that tick happened to come around.
 */
export function subscribeContactSync(listener: () => void): () => void {
  return subscribe(listener);
}

/** Called from the "Sync from mailbox" button — ContactSyncStatus's loop picks this up. */
export function requestContactSyncRun(): void {
  runRequested = true;
  // Clear any stop left pending from an earlier pause. The driving loop checks
  // the stop flag on its first iteration, so a stale one would break the very
  // loop this request is starting — making Resume look like it did nothing.
  stopRequested = false;
  markIntent("running");
  // Flip to "running" optimistically rather than waiting for the first server
  // response, which is a batch call that can take minutes to return. Without it
  // the button, the pill and the status line all sit unchanged after the click,
  // making a started sync indistinguishable from one that never fired. Notifying
  // here is also what wakes ContactSyncStatus up to begin the batch loop.
  setContactSyncSnapshot({ status: "running", error: null });
}

/** ContactSyncStatus calls this each tick to see if a run was requested; clears the flag. */
export function consumeContactSyncRunRequest(): boolean {
  if (!runRequested) return false;
  runRequested = false;
  return true;
}

/** Called from the "Stop syncing" control — ContactSyncStatus's loop checks this between batches. */
export function requestContactSyncStop(): void {
  // Set before notifying: the subscriber fires the DELETE synchronously off this
  // notification, and it reads the flag to decide whether to.
  stopRequested = true;
  markIntent("paused");
  // "paused", not "idle": paused is a state the user chose and that persists in
  // the DB until they explicitly resume, and the UI reads it to offer Resume
  // rather than a fresh Sync. Same reasoning as requestContactSyncRun for doing
  // it here — the loop can only acknowledge a stop between batches, and a batch
  // can be minutes long, so the UI would otherwise keep claiming "Syncing…".
  setContactSyncSnapshot({ status: "paused", error: null });
}

/** ContactSyncStatus calls this between batches to see if a stop was requested; clears the flag. */
export function consumeContactSyncStopRequest(): boolean {
  if (!stopRequested) return false;
  stopRequested = false;
  return true;
}

/**
 * Non-clearing read of the same flag. The driving loop can only consume a stop
 * between batches — and a batch blocks for up to ~250s — so ContactSyncStatus
 * watches this separately to pause the sync server-side the moment Stop is
 * clicked, without swallowing the flag the loop still needs to break on.
 */
export function isContactSyncStopRequested(): boolean {
  return stopRequested;
}

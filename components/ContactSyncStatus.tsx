"use client";

import { useEffect, useRef } from "react";
import { Pause, RefreshCw } from "lucide-react";
import {
  clearContactSyncIntent,
  consumeContactSyncRunRequest,
  consumeContactSyncStopRequest,
  getContactSyncIntent,
  getContactSyncSnapshot,
  isContactSyncStopRequested,
  requestContactSyncRun,
  requestContactSyncStop,
  setContactSyncSnapshot,
  subscribeContactSync,
  useContactSyncSnapshot,
} from "@/lib/contact-sync-store";
import { titleCase } from "@/lib/title-case";
import type { ContactSyncStateRow } from "@/app/api/directory-contacts/sync/status/route";

/**
 * sessionStorage is per-tab and, unlike localStorage, is wiped when the tab
 * closes while surviving a reload — which is exactly the distinction needed
 * here. Its presence means "this tab already saw this sync alive", so a reload
 * continues silently; its absence in a tab that finds an idle-but-unfinished
 * sync means the tab that was driving it is gone.
 */
const TAB_SESSION_KEY = "contact-sync-tab-session";

/**
 * Grace period before an unfinished sync with no live driver is treated as
 * abandoned. Comfortably longer than any legitimate gap between batches,
 * including the 60s the client sleeps while waiting out a Gmail quota window —
 * so a second tab opened mid-sync never mistakes a healthy handoff for a
 * dead driver and pauses someone else's run.
 */
const ABANDONED_AFTER_MS = 90_000;

function hasTabSession(): boolean {
  try {
    return window.sessionStorage.getItem(TAB_SESSION_KEY) === "1";
  } catch {
    // Private mode / storage disabled — fall back to never claiming abandonment,
    // i.e. today's auto-resume behaviour rather than pausing a healthy sync.
    return true;
  }
}

function markTabSession(): void {
  try {
    window.sessionStorage.setItem(TAB_SESSION_KEY, "1");
  } catch {
    // Non-fatal; see hasTabSession.
  }
}

/** Maps a `contact_sync_state` row onto the shared client snapshot shape. */
function applyStateRow(row: ContactSyncStateRow | null) {
  if (!row) {
    setContactSyncSnapshot({ status: "idle", phase: null, error: null });
    return;
  }

  const idleForMs = Date.now() - new Date(row.updated_at).getTime();
  // An unfinished sync, no batch running, no tab here that ever saw it alive,
  // and nothing has touched it in a while: whoever was driving it closed their
  // tab or crashed. Persist the pause so the DB agrees, and offer Resume rather
  // than restarting ~30k messages of scanning nobody asked for.
  if (row.resumable && !hasTabSession() && idleForMs > ABANDONED_AFTER_MS) {
    void fetch("/api/directory-contacts/sync", { method: "DELETE" }).catch(() => {});
    setContactSyncSnapshot({
      status: "paused",
      phase: row.phase,
      messagesScanned: row.messages_scanned_total,
      contactsFound: row.contacts_found_total,
      messagesTotalEstimate: row.last_progress?.total ?? null,
      summary: row.last_summary,
      error: null,
    });
    return;
  }

  // A resumable row means a batch just handed off mid-sync: no batch is
  // executing this instant, but the sync as a whole is still in flight.
  // Surfacing it as "running" is what keeps the pill up and makes driveLoop
  // below pick the work back up.
  const status = row.status === "idle" && row.resumable ? "running" : row.status;

  // Any tab that witnesses the sync alive earns the right to take it over later,
  // not just the one driving it — otherwise closing the driving tab would strand
  // a run that another open tab could have carried on.
  if (status === "running") markTabSession();

  // A just-clicked Pause/Resume outranks a row that predates the click. Progress
  // numbers are still worth taking from it; the status is not, until the server
  // has caught up — otherwise the button flips back and forth while the request
  // is still in flight.
  const pendingIntent = getContactSyncIntent();
  if (pendingIntent) {
    if (pendingIntent.status === status) {
      clearContactSyncIntent();
    } else {
      setContactSyncSnapshot({
        phase: row.phase,
        messagesScanned: row.messages_scanned_total,
        contactsFound: row.contacts_found_total,
        messagesTotalEstimate: row.last_progress?.total ?? null,
      });
      return;
    }
  }

  setContactSyncSnapshot({
    status,
    phase: row.phase,
    messagesScanned: row.messages_scanned_total,
    contactsFound: row.contacts_found_total,
    messagesTotalEstimate: row.last_progress?.total ?? null,
    summary: row.last_summary,
    error: row.error_message,
  });
}

async function refreshStatus() {
  try {
    const res = await fetch("/api/directory-contacts/sync/status");
    const json = await res.json().catch(() => ({}));
    if (res.ok) applyStateRow(json.state ?? null);
  } catch {
    // Best-effort — next poll tick will retry.
  }
}

/**
 * Always-mounted (see AppShell.tsx, next to MailboxSessionSync) so the shared-mailbox
 * contact sync keeps running — and stays visible via the pill below — across
 * client-side navigation between workspace pages, not just while the Contacts tab
 * is open. Drives the resumable batch loop against /api/directory-contacts/sync.
 */
export function ContactSyncStatus() {
  const snapshot = useContactSyncSnapshot();
  const loopActiveRef = useRef(false);
  /** Epoch ms before which driveLoop won't re-POST after a 409 — see driveLoop. */
  const cooldownUntilRef = useRef(0);

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    async function driveLoop() {
      if (loopActiveRef.current) return;
      const wantsRun = consumeContactSyncRunRequest();
      const alreadyRunning = getContactSyncSnapshot().status === "running";
      if (!wantsRun && !alreadyRunning) return;

      // A 409 means someone else holds the lock (another tab, or cron) or the
      // sync is paused. Neither resolves within a tick, so retrying at 1.5s just
      // fills the network log with failures for as long as the other driver's
      // batch runs. Progress stays visible throughout via liveProgressTick, which
      // reads the shared row rather than competing for the lock. An explicit
      // click always bypasses the cooldown.
      if (!wantsRun && Date.now() < cooldownUntilRef.current) return;

      loopActiveRef.current = true;
      // This tab is now driving, so a reload of it should resume rather than
      // treat the run as abandoned.
      markTabSession();
      setContactSyncSnapshot({ status: "running", error: null });
      try {
        let done = false;
        let stopped = false;
        // Only the first request of a run the user actually asked for may restart
        // a paused sync. Continuation requests must not, or a pause would last
        // exactly one poll — see the POST handler in the sync route.
        let sendResume = wantsRun;
        while (!done) {
          // The DELETE went out the moment Pause was clicked; this only has to
          // get the loop to stop asking for further batches.
          if (consumeContactSyncStopRequest()) {
            stopped = true;
            break;
          }
          const res = await fetch(
            sendResume ? "/api/directory-contacts/sync?resume=1" : "/api/directory-contacts/sync",
            { method: "POST" }
          );
          sendResume = false;

          if (res.status === 409) {
            // Paused waits for a deliberate Resume, so back off harder there than
            // for a lock that will free itself when the other driver's batch ends.
            const body = await res.json().catch(() => ({}));
            cooldownUntilRef.current = Date.now() + (body.paused ? 60_000 : 15_000);
            break;
          }

          if (res.status === 429) {
            // Gmail's per-minute quota, not a failure: the batch saved its cursor
            // before returning, so waiting out the window and re-POSTing continues
            // exactly where it stopped. Surfaced in the pill because the scanned
            // count freezes for the duration and would otherwise read as a stall.
            const body = await res.json().catch(() => ({}));
            const waitSecs = Number(body.retryAfterSeconds) || 60;
            setContactSyncSnapshot({
              status: "running",
              notice: `Gmail quota reached — resuming in ${waitSecs}s…`,
            });
            await new Promise((resolve) => window.setTimeout(resolve, waitSecs * 1000));
            setContactSyncSnapshot({ notice: null });
            continue;
          }

          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || "Sync failed");
          done = Boolean(json.done);
          setContactSyncSnapshot({
            // A pause requested while this batch was in flight must win over the
            // response that's only now arriving, or the UI would snap back to
            // "running" for the moment it takes the loop to notice the stop.
            // It resolves to "paused", not "idle" — landing on idle first would
            // flash the button through "Sync from mailbox" before settling on
            // "Resume syncing" a tick later.
            status: isContactSyncStopRequested() ? "paused" : done ? "idle" : "running",
            phase: json.phase ?? null,
            // Cumulative total, not this-call's delta — see runContactSyncBatch.
            messagesScanned: json.messagesScannedTotal ?? 0,
          });
        }
        if (stopped) {
          setContactSyncSnapshot({ status: "paused", error: null });
        } else {
          await refreshStatus();
        }
      } catch (e) {
        setContactSyncSnapshot({
          status: "error",
          error: e instanceof Error ? e.message : "Sync failed",
        });
      } finally {
        loopActiveRef.current = false;
      }
    }

    // Stop has to reach the server without waiting for the in-flight batch to
    // return, which can take the full ~250s budget — driveLoop can't send it,
    // because it's blocked awaiting that very request. Deliberately does not
    // consume the flag: the loop still needs to see it to stop asking for more
    // batches. Pausing the row server-side is also what makes Stop work at all
    // when the sync is being driven by cron or by another tab.
    let stopDispatched = false;
    function dispatchStopIfRequested() {
      if (!isContactSyncStopRequested()) {
        stopDispatched = false;
        return;
      }
      if (stopDispatched) return;
      stopDispatched = true;
      void fetch("/api/directory-contacts/sync", { method: "DELETE" }).catch(() => {});
    }

    // React to the request itself rather than to the next poll: both Pause and
    // Sync notify the store, so this reacts on the click instead of up to 1.5s
    // later. driveLoop is re-entrant-safe (loopActiveRef) and returns
    // immediately when there's nothing to do, so running it on every snapshot
    // change is cheap.
    //
    // Deferred out of the notification pass on purpose: driveLoop writes to the
    // store itself, and doing that synchronously inside listeners.forEach means
    // the snapshot identity changes while useSyncExternalStore is still
    // processing the previous change — which React flags as an uncached
    // getSnapshot and answers with repeated re-renders. A macrotask hop keeps
    // the store mutation outside React's pass; 0ms is still immediate next to
    // the 1.5s fallback tick.
    const unsubscribe = subscribeContactSync(() => {
      window.setTimeout(() => {
        dispatchStopIfRequested();
        void driveLoop();
      }, 0);
    });

    // Safety net for state that changes with no local notification — another tab,
    // or cron.
    const fastTick = window.setInterval(() => {
      dispatchStopIfRequested();
      void driveLoop();
    }, 1500);
    // Catches a run started by another tab/user — skip while this tab is actively driving one
    // (that case is covered by liveProgressTick below, which polls even mid-batch).
    const slowTick = window.setInterval(() => {
      if (!loopActiveRef.current) void refreshStatus();
    }, 20_000);
    // The active driving call blocks server-side for up to ~250s per batch (see
    // BATCH_TIME_BUDGET_MS) — without this, the pill would sit frozen the whole
    // time and jump in one big chunk when the call finally returns. The server
    // persists messages_scanned_total after every page (500 messages) though, so
    // polling independently of loopActiveRef surfaces that same granularity here.
    const liveProgressTick = window.setInterval(() => {
      if (getContactSyncSnapshot().status === "running") void refreshStatus();
    }, 3000);

    return () => {
      unsubscribe();
      window.clearInterval(fastTick);
      window.clearInterval(slowTick);
      window.clearInterval(liveProgressTick);
    };
  }, []);

  // Paused keeps the pill up rather than hiding it: an unfinished sync is state
  // the user needs to know persists across sessions, and this is where they get
  // to act on it. It stays until they resume or the run completes.
  const paused = snapshot.status === "paused";
  if (snapshot.status !== "running" && !paused) return null;

  return (
    <div
      className="surface-card fixed bottom-6 right-6 z-[60] flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-[var(--color-text)] shadow-lg"
      role="status"
    >
      {paused ? (
        <Pause className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-copper)]" />
      )}
      <span>
        {titleCase(
          paused
            ? `Sync paused at ${snapshot.messagesScanned} emails`
            : (snapshot.notice ??
              (snapshot.phase === "incremental"
                ? "Syncing new mail…"
                : `Syncing mailbox — ${snapshot.messagesScanned} emails scanned so far…`))
        )}
      </span>
      <button
        type="button"
        data-testid={paused ? "contact-sync-resume-btn" : "contact-sync-stop-btn"}
        onClick={() => (paused ? requestContactSyncRun() : requestContactSyncStop())}
        className="ml-1 shrink-0 rounded-full px-2 py-1 text-[12px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
      >
        {titleCase(paused ? "Resume" : "Pause")}
      </button>
    </div>
  );
}

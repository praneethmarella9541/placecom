"use client";

import { useEffect, useRef } from "react";
import { RefreshCw } from "lucide-react";
import {
  consumeContactSyncRunRequest,
  consumeContactSyncStopRequest,
  getContactSyncSnapshot,
  requestContactSyncStop,
  setContactSyncSnapshot,
  useContactSyncSnapshot,
} from "@/lib/contact-sync-store";
import { titleCase } from "@/lib/title-case";
import type { ContactSyncStateRow } from "@/app/api/directory-contacts/sync/status/route";

/** Maps a `contact_sync_state` row onto the shared client snapshot shape. */
function applyStateRow(row: ContactSyncStateRow | null) {
  if (!row) {
    setContactSyncSnapshot({ status: "idle", phase: null, error: null });
    return;
  }
  setContactSyncSnapshot({
    status: row.status,
    phase: row.phase,
    messagesScanned: row.messages_scanned_total,
    contactsFound: row.contacts_found_total,
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

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    async function driveLoop() {
      if (loopActiveRef.current) return;
      const wantsRun = consumeContactSyncRunRequest();
      const alreadyRunning = getContactSyncSnapshot().status === "running";
      if (!wantsRun && !alreadyRunning) return;

      loopActiveRef.current = true;
      setContactSyncSnapshot({ status: "running", error: null });
      try {
        let done = false;
        let stopped = false;
        while (!done) {
          if (consumeContactSyncStopRequest()) {
            stopped = true;
            // Best-effort — mark the row idle server-side too, so a reload or
            // another tab doesn't treat it as still "running" and resume it.
            void fetch("/api/directory-contacts/sync", { method: "DELETE" }).catch(() => {});
            break;
          }
          const res = await fetch("/api/directory-contacts/sync", { method: "POST" });
          if (res.status === 409) break; // another tab is already driving this sync
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || "Sync failed");
          done = Boolean(json.done);
          setContactSyncSnapshot({
            status: done ? "idle" : "running",
            phase: json.phase ?? null,
            // Cumulative total, not this-call's delta — see runContactSyncBatch.
            messagesScanned: json.messagesScannedTotal ?? 0,
          });
        }
        if (stopped) {
          setContactSyncSnapshot({ status: "idle", error: null });
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

    const fastTick = window.setInterval(() => void driveLoop(), 1500);
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
      window.clearInterval(fastTick);
      window.clearInterval(slowTick);
      window.clearInterval(liveProgressTick);
    };
  }, []);

  if (snapshot.status !== "running") return null;

  return (
    <div
      className="surface-card fixed bottom-6 right-6 z-[60] flex items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-[var(--color-text)] shadow-lg"
      role="status"
    >
      <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--color-copper)]" />
      <span>
        {titleCase(
          snapshot.phase === "incremental"
            ? "Syncing new mail…"
            : `Syncing mailbox — ${snapshot.messagesScanned} emails scanned so far…`
        )}
      </span>
      <button
        type="button"
        data-testid="contact-sync-stop-btn"
        onClick={() => requestContactSyncStop()}
        className="ml-1 shrink-0 rounded-full px-2 py-1 text-[12px] font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
      >
        {titleCase("Stop")}
      </button>
    </div>
  );
}

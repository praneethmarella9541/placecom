import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { getMailboxAccessTokenForOwner } from "@/lib/mailbox-access-cron";
import { runContactSyncBatch } from "@/lib/people-mailbox-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

// Leaves margin under maxDuration=300 — runContactSyncBatch's own internal
// budget (BATCH_TIME_BUDGET_MS, 250s) means this outer loop typically only
// runs one iteration per invocation; it's here mainly so a call that finishes
// quickly (e.g. near the end of backfill) doesn't waste the rest of this
// invocation's window before the external scheduler calls again.
const CRON_TIME_BUDGET_MS = 270_000;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured — never run unauthenticated
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

/**
 * GET /api/cron/contact-sync — unattended trigger for the shared-mailbox contact
 * sync, meant to be called on a schedule by an external pinger (cron-job.org,
 * Vercel Cron, etc.) rather than driven by a live browser tab (components/
 * ContactSyncStatus.tsx). Works whether or not anyone is logged in: the Gmail
 * token comes from the stored refresh token (lib/mailbox-access-cron.ts), not a
 * session.
 *
 * Auth: either `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>` —
 * cron-job.org supports both; use whichever its UI makes easier to set up.
 *
 * Targets a single fixed mailbox owner (CONTACT_SYNC_MAILBOX_OWNER_ID) — see
 * that env var's comment in .env.example. Skips entirely (no-op) if the sync is
 * "paused" (a user clicked Stop in the app) rather than resuming it — only
 * "Sync from Mailbox" in the UI is allowed to resume a paused sync.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerUserId = process.env.CONTACT_SYNC_MAILBOX_OWNER_ID?.trim();
  if (!ownerUserId) {
    return NextResponse.json({ error: "CONTACT_SYNC_MAILBOX_OWNER_ID is not configured" }, { status: 500 });
  }

  const svc = createServiceSupabase();

  const { data: state, error: stateErr } = await svc
    .from("contact_sync_state")
    .select("status")
    .eq("mailbox_owner_id", ownerUserId)
    .maybeSingle();
  if (stateErr) {
    return NextResponse.json({ error: stateErr.message }, { status: 500 });
  }
  if (state?.status === "paused") {
    return NextResponse.json({ skipped: true, reason: "paused" });
  }

  const tokenResult = await getMailboxAccessTokenForOwner(svc, ownerUserId);
  if (!tokenResult.ok) {
    return NextResponse.json({ error: tokenResult.message }, { status: tokenResult.status });
  }

  const startedAt = Date.now();
  let batches = 0;
  let lastResult: Awaited<ReturnType<typeof runContactSyncBatch>> | null = null;

  while (Date.now() - startedAt < CRON_TIME_BUDGET_MS) {
    const result = await runContactSyncBatch(
      svc,
      ownerUserId,
      tokenResult.accessToken,
      tokenResult.gmailAddress,
      ownerUserId
    );
    lastResult = result;
    batches++;
    if (result.status !== "ok" || result.done) break;
  }

  if (lastResult?.status === "already_running") {
    // A live browser tab is actively driving it right now — nothing for cron to do this tick.
    return NextResponse.json({ skipped: true, reason: "already_running" });
  }
  if (lastResult?.status === "rate_limited") {
    // Progress is saved; the next scheduled tick picks up where this left off,
    // by which point the per-minute quota window has long since reset.
    return NextResponse.json({ skipped: true, reason: "rate_limited", batches });
  }
  if (lastResult?.status === "paused") {
    // Stopped from the UI partway through this invocation's loop — respect it
    // rather than picking the work straight back up on the next iteration.
    return NextResponse.json({ skipped: true, reason: "paused", batches });
  }
  if (lastResult?.status === "error") {
    return NextResponse.json({ error: lastResult.message }, { status: 500 });
  }

  return NextResponse.json({ batches, result: lastResult });
}

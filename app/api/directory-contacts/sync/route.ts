import { dbErrorMessage } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { contactSyncTarget } from "@/lib/contact-sync-target";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { runContactSyncBatch } from "@/lib/people-mailbox-sync";

export const runtime = "nodejs";
// A single batch pages through as much mail as fits in this budget, then returns
// so the client can call again — same ceiling as the other long-running routes.
export const maxDuration = 300;

/**
 * POST /api/directory-contacts/sync — run one batch of the resumable shared-mailbox
 * contact sync. Returns `{ done: false }` if there's more to do (caller should POST
 * again immediately); progress is persisted in contact_sync_state regardless, so
 * this can be safely re-invoked from a background loop across page navigations.
 *
 * Syncs the mailbox the caller is working in — the common one, or (BYOM) their own — into
 * the org's one shared contact book. See lib/contact-sync-target.ts for who may.
 */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const target = await contactSyncTarget(request, user.id, supabase);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  // Only reads mail; who may run it at all is the target check above.
  const auth = await requireGmailAccessToken(request, { need: "read" });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  // Only `?resume=1` may restart a paused sync, and the client sends it on the
  // first request of a user-initiated run — never on the continuation requests
  // that drive an already-running batch loop. Without that distinction a pause
  // survives only until the next poll, because every continuation POST would
  // count as consent to resume.
  const isExplicitResume = new URL(request.url).searchParams.get("resume") === "1";

  const result = await runContactSyncBatch(
    target.client,
    user.id,
    auth.accessToken,
    auth.gmailAddress,
    target.stateKey,
    { resumePaused: isExplicitResume, poolOwnerId: target.poolOwnerId }
  );

  if (result.status === "already_running") {
    return NextResponse.json({ error: "A sync is already running" }, { status: 409 });
  }
  if (result.status === "paused") {
    return NextResponse.json(
      { error: "Sync is paused", paused: true },
      { status: 409 }
    );
  }
  if (result.status === "rate_limited") {
    // 429, not 500: progress is saved and the sync is healthy — the client just
    // has to wait out Gmail's per-minute window before asking for another batch.
    return NextResponse.json(
      { error: "Gmail quota reached", rateLimited: true, retryAfterSeconds: 60 },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  if (result.status === "error") {
    return NextResponse.json({ error: result.message }, { status: 500 });
  }
  return NextResponse.json(result);
}

/**
 * DELETE /api/directory-contacts/sync — stop the resumable sync. Marks the row
 * "paused" (not "idle" — see app/api/cron/contact-sync) immediately rather than
 * leaving it "running" for the stale-lock window in runContactSyncBatch, so a
 * page reload or another tab doesn't pick it back up. "Sync from Mailbox" (POST,
 * above) resumes it from "paused" exactly like from "idle" — the distinction
 * only matters to the cron job, which skips a "paused" row instead of resuming
 * it on its own.
 */
export async function DELETE(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Stops the sync of the mailbox the caller is working in, if they may run it.
  const target = await contactSyncTarget(request, user.id, supabase);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });

  const { error } = await target.client
    .from("contact_sync_state")
    .update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("mailbox_owner_id", target.stateKey)
    // Matches "running OR (idle with a stored cursor)". Batches release the lock
    // between each other now, so a Stop click frequently lands while the row is
    // momentarily "idle" mid-sync — matching only "running" would silently no-op
    // and the next poll would resume it. The page_token clause keeps this from
    // pausing a sync that has genuinely finished (cursor null), which would stop
    // cron from running incremental syncs until someone clicked Sync again.
    .in("status", ["running", "idle"])
    .or("status.eq.running,page_token.not.is.null");

  if (error) {
    return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

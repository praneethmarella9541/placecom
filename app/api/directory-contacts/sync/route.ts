import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { runContactSyncBatch } from "@/lib/people-mailbox-sync";

export const runtime = "nodejs";
// A single batch pages through as much mail as fits in this budget, then returns
// so the client can call again — same ceiling as /api/fetch-emails and /api/extract.
export const maxDuration = 300;

/**
 * POST /api/directory-contacts/sync — run one batch of the resumable shared-mailbox
 * contact sync. Returns `{ done: false }` if there's more to do (caller should POST
 * again immediately); progress is persisted in contact_sync_state regardless, so
 * this can be safely re-invoked from a background loop across page navigations.
 */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const result = await runContactSyncBatch(
    supabase,
    user.id,
    auth.accessToken,
    auth.gmailAddress,
    auth.mailboxOwnerId
  );

  if (result.status === "already_running") {
    return NextResponse.json({ error: "A sync is already running" }, { status: 409 });
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

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { error } = await supabase
    .from("contact_sync_state")
    .update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("mailbox_owner_id", auth.mailboxOwnerId)
    .eq("status", "running"); // no-op if it already finished/errored between the click and this request

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

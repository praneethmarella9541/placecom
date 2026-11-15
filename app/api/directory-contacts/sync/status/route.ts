import { dbErrorMessage } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { contactSyncTarget } from "@/lib/contact-sync-target";

export const runtime = "nodejs";

export type ContactSyncStateRow = {
  status: "idle" | "running" | "paused" | "error";
  phase: "backfill" | "incremental" | null;
  messages_scanned_total: number;
  contacts_found_total: number;
  /** `total` is Gmail's estimate of matching messages — the progress bar's denominator. */
  last_progress: { scanned: number; total?: number | null } | null;
  last_summary: string | null;
  completed_backfill_at: string | null;
  error_message: string | null;
  updated_at: string;
  /**
   * Work remains but no batch is executing right now — a stored page cursor with
   * the lock released (see the not-done branches in lib/people-mailbox-sync.ts).
   * Derived rather than stored, because "is a batch running" and "is there more
   * to do" are different questions that `status` alone used to conflate.
   */
  resumable: boolean;
};

/** GET /api/directory-contacts/sync/status — cheap poll target, no Gmail calls. */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // The sync of the mailbox the caller is working in, shown only to someone who may run it
  // (lib/contact-sync-target.ts) — BYOM gives each mailbox its own progress row.
  const target = await contactSyncTarget(request, user.id, supabase);
  if (!target.ok) return NextResponse.json({ state: null, unavailable: true });

  // No profiles lookup to resolve the mailbox owner first. This table holds one
  // row per owner and its RLS policy already scopes it to exactly the caller's
  // mailbox (migration 0047, via current_mailbox_owner_id()), so an unfiltered
  // read returns their row or nothing at all. Every open tab polls this every
  // 20s while idle, so halving it to one round trip is worth more here than the
  // explicitness of naming the owner. A caller with no mailbox owner sees no
  // rows, which lands on the same `{ state: null }` as before.
  //
  // Resolved this way rather than through requireGmailAccessToken to keep it a
  // cheap poll target — no Google token refresh round-trip on every call.
  const { data, error } = await target.client
    .from("contact_sync_state")
    .select(
      "status, phase, page_token, messages_scanned_total, contacts_found_total, last_progress, last_summary, completed_backfill_at, error_message, updated_at"
    )
    .eq("mailbox_owner_id", target.stateKey)
    .maybeSingle();

  if (error) {
    if (/relation.*contact_sync_state.*does not exist/i.test(error.message)) {
      return NextResponse.json({ state: null });
    }
    return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  }

  if (!data) return NextResponse.json({ state: null });

  // "paused" is deliberately excluded: the user stopped this sync, so a leftover
  // cursor is not an invitation for another tab to pick it back up.
  const { page_token: pageToken, ...row } = data;
  const resumable = data.status === "idle" && pageToken !== null;

  return NextResponse.json({ state: { ...row, resumable } as ContactSyncStateRow });
}

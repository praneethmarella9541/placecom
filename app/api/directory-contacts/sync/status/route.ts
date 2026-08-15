import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";

export const runtime = "nodejs";

export type ContactSyncStateRow = {
  status: "idle" | "running" | "paused" | "error";
  phase: "backfill" | "incremental" | null;
  messages_scanned_total: number;
  contacts_found_total: number;
  last_progress: { scanned: number } | null;
  last_summary: string | null;
  completed_backfill_at: string | null;
  error_message: string | null;
  updated_at: string;
};

/** GET /api/directory-contacts/sync/status — cheap poll target, no Gmail calls. */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Resolved from `profiles` directly (not requireGmailAccessToken) to keep this
  // a cheap poll target — no Google token refresh round-trip on every call.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  const mailboxOwnerId = profile?.role === "admin" ? user.id : profile?.mailbox_owner_id;
  if (!mailboxOwnerId) return NextResponse.json({ state: null });

  const { data, error } = await supabase
    .from("contact_sync_state")
    .select(
      "status, phase, messages_scanned_total, contacts_found_total, last_progress, last_summary, completed_backfill_at, error_message, updated_at"
    )
    .eq("mailbox_owner_id", mailboxOwnerId)
    .maybeSingle();

  if (error) {
    if (/relation.*contact_sync_state.*does not exist/i.test(error.message)) {
      return NextResponse.json({ state: null });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ state: (data ?? null) as ContactSyncStateRow | null });
}

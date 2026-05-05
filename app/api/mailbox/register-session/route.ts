import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isMailboxMigrationNotApplied } from "@/lib/supabase-mailbox-migration";

export const runtime = "nodejs";

/**
 * Persists the admin's Google refresh token (from the Supabase session) so Gmail/Drive
 * keep working for days without asking the admin to re-consent. Staff use this row via
 * `profiles.mailbox_owner_id`.
 */
export async function POST() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr && isMailboxMigrationNotApplied(profileErr)) {
    return NextResponse.json({ skipped: true, reason: "migration_not_applied" });
  }
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ skipped: true, reason: "no_profile_row" });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ skipped: true });
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const refresh = session?.provider_refresh_token;
  const access = session?.provider_token;
  if (!refresh) {
    return NextResponse.json(
      {
        error:
          "No Google refresh token in session. Sign out and sign in with Google again (offline access).",
      },
      { status: 400 }
    );
  }

  const googleAccessExpiresAt = new Date(Date.now() + 50 * 60 * 1000).toISOString();

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ skipped: true, reason: "service_role_unconfigured" });
  }

  const { error: upErr } = await svc.from("google_mailbox_credentials").upsert(
    {
      owner_user_id: user.id,
      gmail_address: user.email ?? null,
      refresh_token: refresh,
      access_token: access ?? null,
      access_token_expires_at: access ? googleAccessExpiresAt : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_user_id" }
  );

  if (upErr) {
    if (isMailboxMigrationNotApplied(upErr)) {
      return NextResponse.json({ skipped: true, reason: "migration_not_applied" });
    }
    console.error(upErr);
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

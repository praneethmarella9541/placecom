import { NextResponse } from "next/server";
import { isMeetOrganizerAccountEmail } from "@/lib/google-meet-organizer";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isMailboxMigrationNotApplied } from "@/lib/supabase-mailbox-migration";
import { getAuthedRequest } from "@/lib/api-auth";

export const runtime = "nodejs";

type RegisterBody = {
  /** Mobile passes these explicitly (Bearer auth has no cookie session to read). */
  providerRefreshToken?: string;
  providerAccessToken?: string;
};

/**
 * Persists the admin's Google refresh token (from the Supabase session) so Gmail/Drive
 * keep working for days without asking the admin to re-consent. Staff use this row via
 * `profiles.mailbox_owner_id`.
 *
 * Web (cookie session): reads provider tokens from supabase.auth.getSession().
 * Mobile (Bearer): pass providerRefreshToken / providerAccessToken in the body,
 *   since the server can't read the mobile session.provider_* fields.
 */
export async function POST(request: Request) {
  const authed = await getAuthedRequest(request);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = authed.user;
  const supabase = createServerSupabaseClient();

  // Cookie session (web) — refresh token lives in supabase session.
  // Bearer (mobile) — caller must pass tokens in the body.
  let body: RegisterBody = {};
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    body = {};
  }

  const { data: profile, error: profileErr } = await authed.supabase
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
  const saveMeetOrganizer =
    isMeetOrganizerAccountEmail(user.email) && profile.role !== "admin";
  if (profile.role !== "admin" && !saveMeetOrganizer) {
    return NextResponse.json({ skipped: true });
  }

  // For cookie sessions the refresh token comes from supabase.auth's session.
  // Bearer-authed mobile requests have no cookie, so they pass tokens in the body.
  let refresh: string | null | undefined = body.providerRefreshToken?.trim() || undefined;
  let access: string | null | undefined = body.providerAccessToken?.trim() || undefined;
  if (!refresh && !access && !authed.isBearer) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    refresh = session?.provider_refresh_token ?? undefined;
    access = session?.provider_token ?? undefined;
  }
  const googleAccessExpiresAt = access ? new Date(Date.now() + 50 * 60 * 1000).toISOString() : null;

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ skipped: true, reason: "service_role_unconfigured" });
  }

  const { data: existing, error: existingErr } = await svc
    .from("google_mailbox_credentials")
    .select("refresh_token")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (existingErr && !isMailboxMigrationNotApplied(existingErr)) {
    return NextResponse.json({ error: existingErr.message }, { status: 500 });
  }

  const effectiveRefresh =
    (refresh && refresh.trim()) ||
    ((existing?.refresh_token as string | null | undefined)?.trim() ?? null);
  if (!effectiveRefresh && !access) {
    return NextResponse.json(
      {
        error:
          "No Google token in session. Sign out and sign in with Google again (offline access).",
      },
      { status: 400 },
    );
  }

  const { error: upErr } = await svc.from("google_mailbox_credentials").upsert(
    {
      owner_user_id: user.id,
      gmail_address: user.email ?? null,
      refresh_token: effectiveRefresh,
      access_token: access ?? null,
      access_token_expires_at: googleAccessExpiresAt,
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

  return NextResponse.json({
    ok: true,
    meetOrganizer: saveMeetOrganizer || undefined,
  });
}

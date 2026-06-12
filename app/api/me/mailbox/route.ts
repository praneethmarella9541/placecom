import { NextResponse } from "next/server";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isMailboxMigrationNotApplied } from "@/lib/supabase-mailbox-migration";
import { mergeRestrictedFeatures } from "@/lib/profile-access";
import { getAuthedRequest } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Try Bearer-token auth first (mobile), then fall back to cookie auth (web).
  const authed = await getAuthedRequest(request);
  let user = authed?.user ?? null;
  const supabase = createServerSupabaseClient();
  if (!user) {
    const { data, error: userErr } = await supabase.auth.getUser();
    if (userErr || !data.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    user = data.user;
  }

  let { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, mailbox_owner_id, display_username, restricted_features, group_id, exotel_virtual_number")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr && /restricted_features|group_id|exotel_virtual_number/i.test(profileErr.message ?? "")) {
    const fallback = await supabase
      .from("profiles")
      .select("role, mailbox_owner_id, display_username")
      .eq("id", user.id)
      .maybeSingle();
    profile = fallback.data as typeof profile;
    profileErr = fallback.error;
  }

  if (profileErr && isMailboxMigrationNotApplied(profileErr)) {
    const body: MeMailboxResponse = {
      sessionEmail: user.email ?? null,
      displayUsername: null,
      role: "staff",
      groupName: null,
      restrictedFeatures: [],
      mailboxOwnerId: null,
      mailboxEmail: null,
      hasStoredMailbox: false,
      exotelVirtualNumber: null,
    };
    return NextResponse.json(body);
  }
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  if (!profile) {
    const body: MeMailboxResponse = {
      sessionEmail: user.email ?? null,
      displayUsername: null,
      role: "staff",
      groupName: null,
      restrictedFeatures: [],
      mailboxOwnerId: null,
      mailboxEmail: null,
      hasStoredMailbox: false,
      exotelVirtualNumber: null,
    };
    return NextResponse.json(body);
  }

  const role = profile.role as string;
  const exotelVirtualNumber = (profile.exotel_virtual_number as string | null) ?? null;
  const mailboxOwnerId =
    role === "admin" ? user.id : (profile.mailbox_owner_id as string | null);

  let group: { name: string; restricted_features: unknown } | null = null;
  if (profile.group_id) {
    try {
      const svc = createServiceSupabase();
      const { data: g } = await svc
        .from("team_groups")
        .select("name, restricted_features")
        .eq("id", profile.group_id as string)
        .maybeSingle();
      if (g) group = g as { name: string; restricted_features: unknown };
    } catch {
      /* ignore */
    }
  }

  let mailboxEmail: string | null = null;
  let hasStoredMailbox = false;
  if (mailboxOwnerId) {
    try {
      const svc = createServiceSupabase();
      const { data: cred, error: credErr } = await svc
        .from("google_mailbox_credentials")
        .select("gmail_address, refresh_token")
        .eq("owner_user_id", mailboxOwnerId)
        .maybeSingle();
      if (!credErr) {
        mailboxEmail = (cred?.gmail_address as string | null) ?? null;
        hasStoredMailbox = Boolean(cred?.refresh_token);
      }
    } catch {
      /* service role env missing in dev — ignore mailbox extras */
    }
  }

  const body: MeMailboxResponse = {
    sessionEmail: user.email ?? null,
    displayUsername: (profile.display_username as string | null) ?? null,
    role,
    restrictedFeatures: mergeRestrictedFeatures(
      {
        role,
        restricted_features: profile.restricted_features,
        group_id: profile.group_id as string | null,
      },
      group
    ),
    groupName: group?.name ?? null,
    mailboxOwnerId,
    mailboxEmail,
    hasStoredMailbox,
    exotelVirtualNumber,
  };
  return NextResponse.json(body);
}

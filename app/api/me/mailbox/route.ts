import { NextResponse } from "next/server";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isMailboxMigrationNotApplied } from "@/lib/supabase-mailbox-migration";

export const runtime = "nodejs";

export async function GET() {
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
    .select("role, mailbox_owner_id, display_username")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr && isMailboxMigrationNotApplied(profileErr)) {
    const body: MeMailboxResponse = {
      sessionEmail: user.email ?? null,
      displayUsername: null,
      role: "staff",
      mailboxOwnerId: null,
      mailboxEmail: null,
      hasStoredMailbox: false,
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
      mailboxOwnerId: null,
      mailboxEmail: null,
      hasStoredMailbox: false,
    };
    return NextResponse.json(body);
  }

  const role = profile.role as string;
  const mailboxOwnerId =
    role === "admin" ? user.id : (profile.mailbox_owner_id as string | null);

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
    mailboxOwnerId,
    mailboxEmail,
    hasStoredMailbox,
  };
  return NextResponse.json(body);
}

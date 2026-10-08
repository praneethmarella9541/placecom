import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { ADMIN_USES_GOOGLE_MESSAGE } from "@/lib/password-setup";
import { NOT_IN_TEAM_MESSAGE } from "@/lib/team-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

/** The auth user for an email, or null. Pages through auth users — there is no lookup-by-email in the admin API. */
async function findUserIdByEmail(email: string): Promise<string | null> {
  const svc = createServiceSupabase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < PAGE_SIZE) return null;
  }
  return null;
}

/**
 * POST /api/auth/forgot-password/check — whether "Forgot password?" may send a
 * link to this email. The link is for team members who sign in with a password:
 * admins sign in with Google and get no link, and an address no admin has added
 * to a team gets none either. The login page asks this before it requests the
 * link; /auth/callback/exchange independently refuses to sign an admin in through
 * one, so a link requested some other way still can't be used by an admin.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return NextResponse.json({ error: "Enter your work email." }, { status: 400 });

  try {
    const userId = await findUserIdByEmail(email);
    if (!userId) {
      return NextResponse.json({ ok: false, reason: "not_in_team", error: NOT_IN_TEAM_MESSAGE }, { status: 403 });
    }
    const { data: profile } = await createServiceSupabase()
      .from("profiles")
      .select("role, mailbox_owner_id")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.role === "admin") {
      return NextResponse.json({ ok: false, reason: "admin", error: ADMIN_USES_GOOGLE_MESSAGE }, { status: 403 });
    }
    if (!profile?.mailbox_owner_id) {
      return NextResponse.json({ ok: false, reason: "not_in_team", error: NOT_IN_TEAM_MESSAGE }, { status: 403 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[forgot-password/check] lookup failed", e);
    return NextResponse.json({ error: "Couldn't check that email. Try again." }, { status: 500 });
  }
}

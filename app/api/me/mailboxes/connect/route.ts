import { NextResponse } from "next/server";
import { getAuthedRequest } from "@/lib/api-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isByomEnabled } from "@/lib/mailbox-context";
import { BYOM_CONNECT_COOKIE } from "@/lib/byom-onboarding";
import { sessionCookieOptions } from "@/lib/auth-cookies";

export const runtime = "nodejs";

/**
 * POST /api/me/mailboxes/connect — Settings' "Connect your own mailbox". Marks the Google
 * sign-in the browser starts next as a request to connect it as this user's own mailbox
 * (see attachIndividualMailbox). The mark names the user, so it can't connect anyone else,
 * and expires in ten minutes.
 */
export async function POST(request: Request) {
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isByomEnabled(createServiceSupabase()))) {
    return NextResponse.json({ error: "Own mailboxes are switched off on this workspace." }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(BYOM_CONNECT_COOKIE, authed.user.id, sessionCookieOptions({ maxAge: 600 }));
  return res;
}

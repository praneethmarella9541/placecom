import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isCrossSiteWrite } from "@/lib/csrf-origin";
import { ADMIN_USES_GOOGLE_MESSAGE } from "@/lib/password-setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /auth/establish — turn tokens Supabase just issued into the HttpOnly session cookie.
 *
 * The browser signs in against Supabase Auth directly (so Supabase's per-IP rate limiting and
 * lockout see the real client) with a client that stores nothing, then posts the two tokens
 * here. setSession() has Supabase validate them; only then does the server write the cookie,
 * through createServerSupabaseClient(), which forces HttpOnly. Nothing readable from page
 * JavaScript is left behind.
 *
 * Administrators sign in with Google only: their second factor is Google 2-Step Verification
 * (enforced for the organisation), which a password sign-in would bypass. So a correct password
 * for an admin account is refused here and the session it just created is revoked. If the role
 * can't be checked, the sign-in is refused too (fail closed). This is the one place a password
 * sign-in turns into a cookie, so it is the right place for that check regardless of how the
 * tokens were obtained.
 *
 * This sits under /auth/ (not /api/) so the middleware gates that block unfinished accounts
 * don't apply, which is why the same-site check is repeated here.
 */
export async function POST(request: Request) {
  if (isCrossSiteWrite(request.method, request.headers)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    access_token?: unknown;
    refresh_token?: unknown;
  } | null;
  const access_token = typeof body?.access_token === "string" ? body.access_token : "";
  const refresh_token = typeof body?.refresh_token === "string" ? body.refresh_token : "";
  if (!access_token || !refresh_token) {
    return NextResponse.json({ error: "Missing session." }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error || !data.session) {
    return NextResponse.json({ error: "Couldn't sign you in. Try again." }, { status: 401 });
  }

  const userId = data.user?.id;
  let isAdmin = false;
  let lookupFailed = !userId;
  if (userId) {
    try {
      const { data: profile, error: profileErr } = await createServiceSupabase()
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      isAdmin = profile?.role === "admin";
    } catch (e) {
      console.error("[auth/establish] role check failed", e);
      lookupFailed = true;
    }
  }

  if (isAdmin || lookupFailed) {
    await supabase.auth.signOut().catch(() => {});
    return isAdmin
      ? NextResponse.json({ error: ADMIN_USES_GOOGLE_MESSAGE }, { status: 403 })
      : NextResponse.json({ error: "Couldn't sign you in. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

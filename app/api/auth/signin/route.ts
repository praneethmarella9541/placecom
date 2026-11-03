import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { ADMIN_USES_GOOGLE_MESSAGE } from "@/lib/password-setup";

/**
 * Email + password sign-in for team members, done server-side so the session cookie is issued
 * HttpOnly (the browser client would set it as a cookie scripts can read). Supabase Auth still
 * rate-limits and verifies the credentials.
 *
 * Administrators sign in with Google only: their second factor is Google 2-Step Verification
 * (enforced for the organisation), which a password sign-in would bypass. So a correct password
 * for an admin account is refused here and the session it just created is revoked. If the role
 * can't be checked, the sign-in is refused too (fail closed).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 400 });
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
      console.error("[auth/signin] role check failed", e);
      lookupFailed = true;
    }
  }

  if (isAdmin || lookupFailed) {
    await supabase.auth.signOut().catch(() => {});
    return isAdmin
      ? NextResponse.json({ error: ADMIN_USES_GOOGLE_MESSAGE }, { status: 403 })
      : NextResponse.json({ error: "Couldn't sign you in. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

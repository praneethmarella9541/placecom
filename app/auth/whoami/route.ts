import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { mustSetPassword } from "@/lib/password-setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /auth/whoami — the signed-in user, for pages that can no longer read the session in the
 * browser (it is an HttpOnly cookie). Validated against Supabase Auth, not just decoded.
 *
 * Under /auth/ so the sign-in, no-access and set-password pages can all call it.
 */
export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ user: null }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(
    { user: { id: user.id, email: user.email ?? null, mustSetPassword: mustSetPassword(user) } },
    { headers: { "Cache-Control": "no-store" } }
  );
}

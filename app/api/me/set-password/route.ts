import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { MIN_PASSWORD_LENGTH, MUST_SET_PASSWORD_KEY, mustSetPassword } from "@/lib/password-setup";

export const runtime = "nodejs";

/**
 * POST /api/me/set-password — choose a new password without the old one.
 *
 * Only for an account the "Forgot password?" link just signed in (flagged
 * must_set_password by /auth/callback/exchange). Any other session has to use
 * /api/me/password, which asks for the current password — this route must not be
 * a way around that. Sets the password and clears the flag in a single admin
 * update, so the flag can't be cleared without a password actually being saved.
 */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!mustSetPassword(user)) {
    return NextResponse.json(
      { error: "Password setup isn't required for this account. Use Profile to change your password." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as { newPassword?: unknown } | null;
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (newPassword.trim().length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const svc = createServiceSupabase();
  const { error } = await svc.auth.admin.updateUserById(user.id, {
    password: newPassword.trim(),
    app_metadata: { [MUST_SET_PASSWORD_KEY]: false },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

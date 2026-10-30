import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { revokeSessions } from "@/lib/revoke-sessions";

export const runtime = "nodejs";

const MIN_PASSWORD_LEN = 8;

type Body = {
  currentPassword?: string;
  newPassword?: string;
};

/** POST /api/me/password — change password for email/password accounts */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id || !user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appMeta = user.app_metadata as { provider?: string } | undefined;
  if (appMeta?.provider === "google") {
    return NextResponse.json(
      { error: "Google sign-in accounts cannot change password here. Use your Google account settings." },
      { status: 400 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword?.trim() ?? "";

  if (!currentPassword) {
    return NextResponse.json({ error: "Current password is required." }, { status: 400 });
  }
  if (newPassword.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `New password must be at least ${MIN_PASSWORD_LEN} characters.` },
      { status: 400 }
    );
  }

  // Check the current password on a throwaway client. Signing in on the cookie-bound client would swap
  // this browser's session for a new one; this keeps the browser's own session as the one we keep below.
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
  const { error: signInErr } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInErr) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 });
  }

  // This browser stays signed in; every other session is ended.
  await revokeSessions(supabase, "others");

  return NextResponse.json({ ok: true });
}

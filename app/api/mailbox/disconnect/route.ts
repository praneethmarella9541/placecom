import { NextResponse } from "next/server";
import { assertAdminUserId } from "@/lib/admin-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { decryptToken } from "@/lib/token-crypto";
import { revokeGoogleToken } from "@/lib/google-token-revoke";

export const runtime = "nodejs";

/**
 * DELETE — disconnect the admin's Google mailbox: revoke the stored Google tokens at
 * Google, then delete the credentials row. The admin must sign in with Google again to
 * reconnect.
 */
export async function DELETE(request: Request) {
  const auth = await assertAdminUserId(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { data: row, error: readErr } = await svc
    .from("google_mailbox_credentials")
    .select("refresh_token, access_token")
    .eq("owner_user_id", auth.userId)
    .maybeSingle();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  let revoked = false;
  if (row) {
    // Revoking the refresh token also invalidates the access tokens issued from it.
    const token = decryptToken(row.refresh_token as string | null) || decryptToken(row.access_token as string | null);
    if (token) revoked = await revokeGoogleToken(token);
  }

  const { error: delErr } = await svc.from("google_mailbox_credentials").delete().eq("owner_user_id", auth.userId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, revoked });
}

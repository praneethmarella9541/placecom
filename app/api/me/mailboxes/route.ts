import { dbErrorMessage } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { getAuthedRequest } from "@/lib/api-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { decryptToken } from "@/lib/token-crypto";
import { revokeGoogleToken } from "@/lib/google-token-revoke";
import { invalidateMailboxTokenCache } from "@/lib/mailbox-google-token";
import { invalidateResolvedMailboxCache } from "@/lib/mailbox-google-access";
import { MAILBOX_COOKIE } from "@/lib/mailbox-context-shared";

export const runtime = "nodejs";

/**
 * DELETE /api/me/mailboxes — disconnect the caller's own mailbox (BYOM): revoke the Google
 * tokens, delete the stored credentials, and mark the mailbox disconnected. Its sequences
 * stop sending (the runner backs off rather than using another account), and its history
 * stays in analytics. Signing in with Google again reconnects it.
 *
 * Not for admins — their Gmail is the common mailbox (app/api/mailbox/disconnect).
 */
export async function DELETE(request: Request) {
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = authed.user.id;

  const svc = createServiceSupabase();
  const { data: mailbox, error } = await svc
    .from("mailboxes")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("mailbox_type", "individual")
    .maybeSingle();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  if (!mailbox) return NextResponse.json({ error: "You have no mailbox of your own connected." }, { status: 404 });

  const { data: cred } = await svc
    .from("google_mailbox_credentials")
    .select("refresh_token, access_token")
    .eq("owner_user_id", userId)
    .maybeSingle();
  let revoked = false;
  if (cred) {
    const token = decryptToken(cred.refresh_token as string | null) || decryptToken(cred.access_token as string | null);
    if (token) revoked = await revokeGoogleToken(token);
  }
  await svc.from("google_mailbox_credentials").delete().eq("owner_user_id", userId);
  await svc
    .from("mailboxes")
    .update({ status: "disconnected", updated_at: new Date().toISOString() })
    .eq("id", mailbox.id);

  invalidateMailboxTokenCache(userId);
  invalidateResolvedMailboxCache(userId);

  const res = NextResponse.json({ ok: true, revoked });
  res.cookies.delete(MAILBOX_COOKIE);
  return res;
}

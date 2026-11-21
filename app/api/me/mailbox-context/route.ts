import { NextResponse } from "next/server";
import { getAuthedRequest } from "@/lib/api-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isResolveMailboxError, resolveMailboxForUser } from "@/lib/mailbox-context";
import { MAILBOX_COOKIE } from "@/lib/mailbox-context-shared";
import { sessionCookieOptions } from "@/lib/auth-cookies";

export const runtime = "nodejs";

/**
 * PUT /api/me/mailbox-context { mailboxId } — the account switcher. Checks the caller may use
 * that mailbox and remembers it in a cookie. The cookie is only ever a request: every Google
 * call re-checks it (lib/mailbox-context.ts), so a revoked grant takes effect without it changing.
 *
 * The mobile app keeps its choice itself and sends it as the x-nucleus-mailbox header.
 */
export async function PUT(request: Request) {
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { mailboxId?: unknown };
  try {
    body = (await request.json()) as { mailboxId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const mailboxId = typeof body.mailboxId === "string" ? body.mailboxId.trim() : "";
  if (!mailboxId) return NextResponse.json({ error: "mailboxId is required" }, { status: 400 });

  const svc = createServiceSupabase();
  const { data: profile } = await svc
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", authed.user.id)
    .maybeSingle();
  const role = (profile?.role as string) ?? "staff";
  const orgOwnerId = role === "admin" ? authed.user.id : ((profile?.mailbox_owner_id as string | null) ?? null);
  if (!orgOwnerId) return NextResponse.json({ error: "Your account is not on a team." }, { status: 403 });

  const resolved = await resolveMailboxForUser(svc, {
    userId: authed.user.id,
    role,
    orgOwnerId,
    requestedId: mailboxId,
  });
  if (isResolveMailboxError(resolved)) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }
  if (resolved.mailboxId !== mailboxId) {
    return NextResponse.json({ error: "You don't have access to that mailbox." }, { status: 403 });
  }

  const res = NextResponse.json({
    mailboxId: resolved.mailboxId,
    type: resolved.mailboxType,
    access: resolved.access,
    address: resolved.options.find((o) => o.id === resolved.mailboxId)?.address ?? null,
  });
  res.cookies.set(
    MAILBOX_COOKIE,
    mailboxId,
    sessionCookieOptions({ path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 })
  );
  return res;
}

/** DELETE — forget the choice; the default mailbox applies again. */
export async function DELETE(request: Request) {
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(MAILBOX_COOKIE);
  return res;
}

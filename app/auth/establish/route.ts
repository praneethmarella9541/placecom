import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { isCrossSiteWrite } from "@/lib/csrf-origin";

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
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

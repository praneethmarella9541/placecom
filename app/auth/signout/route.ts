import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { isCrossSiteWrite } from "@/lib/csrf-origin";
import { sessionCookieOptions } from "@/lib/auth-cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /auth/signout — end the session on the server.
 *
 * signOut() with Supabase's default (global) scope revokes the user's refresh tokens at the auth
 * server, so a copied refresh token stops working — it is not just a cookie being cleared. The
 * sweep afterwards removes any Supabase cookie that is left (including chunked ones), so the
 * browser holds nothing of the session even if the auth server was unreachable.
 *
 * Under /auth/ so an account that is not on a team, or that still has to choose a password, can
 * always sign out; the same-site check is repeated here for that reason.
 */
export async function POST(request: Request) {
  if (isCrossSiteWrite(request.method, request.headers)) {
    return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
  }

  const supabase = createServerSupabaseClient();
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.error("[auth/signout] sign-out call failed:", e instanceof Error ? e.message : "unknown error");
  }

  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith("sb-")) {
      cookieStore.set(name, "", sessionCookieOptions({ maxAge: 0 }));
    }
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

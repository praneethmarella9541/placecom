import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Sign out on the server: revokes the refresh token with Supabase and clears the
 * HttpOnly session cookies, which scripts in the browser can't remove themselves.
 */
export async function POST() {
  const supabase = createServerSupabaseClient();
  await supabase.auth.signOut().catch(() => {});

  // Belt and braces: if the token was already invalid, signOut may leave cookies behind.
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (name.startsWith("sb-")) store.delete(name);
  }
  return NextResponse.json({ ok: true });
}

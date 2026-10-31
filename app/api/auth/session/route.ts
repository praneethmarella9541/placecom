import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { mustSetPassword } from "@/lib/password-setup";

export const dynamic = "force-dynamic";

/**
 * Who is signed in, for pages that used to ask the browser-side Supabase client.
 * The session cookie is HttpOnly, so scripts can't read it; the server verifies it instead.
 */
export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return NextResponse.json(
    user
      ? { signedIn: true, id: user.id, email: user.email ?? null, mustSetPassword: mustSetPassword(user) }
      : { signedIn: false },
    { headers: { "Cache-Control": "no-store" } }
  );
}

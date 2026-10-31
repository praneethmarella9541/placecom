import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Email + password sign-in, done server-side so the session cookie is issued HttpOnly
 * (the browser client would set it as a cookie scripts can read). Supabase Auth still
 * rate-limits and verifies the credentials.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 400 });
  }
  return NextResponse.json({ ok: true });
}

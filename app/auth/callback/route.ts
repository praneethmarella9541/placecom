import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const MSG_MAX = 450;

function truncateMsg(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  /** Supabase/Google may redirect here with ?error=... when exchange fails upstream */
  const oauthError = searchParams.get("error");
  const oauthDesc = searchParams.get("error_description") ?? "";
  const oauthCode = searchParams.get("error_code") ?? "";
  if (oauthError) {
    const parts = [oauthError, oauthCode, oauthDesc].filter(Boolean);
    const combined = parts.join(" — ");
    const msg = truncateMsg(combined || oauthError, MSG_MAX);
    return NextResponse.redirect(
      `${origin}/?error=auth&msg=${encodeURIComponent(msg)}`
    );
  }

  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/inbox";

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=auth&msg=${encodeURIComponent("Missing authorization code")}`);
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const msg = truncateMsg(error.message, MSG_MAX);
    return NextResponse.redirect(
      `${origin}/?error=auth&msg=${encodeURIComponent(msg)}`
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}

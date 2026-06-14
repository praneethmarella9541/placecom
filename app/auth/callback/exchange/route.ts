import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceSupabase } from "@/lib/supabase-service";

const MSG_MAX = 450;

function truncateMsg(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** Server-side PKCE exchange for the web app (not used for Expo Go handoff). */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

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
    return NextResponse.redirect(
      `${origin}/?error=auth&msg=${encodeURIComponent("Missing authorization code")}`
    );
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

  const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const msg = truncateMsg(error.message, MSG_MAX);
    return NextResponse.redirect(
      `${origin}/?error=auth&msg=${encodeURIComponent(msg)}`
    );
  }

  const session = sessionData?.session;
  const provider = session?.user?.app_metadata?.provider;
  if (provider === "google" && session) {
    try {
      const refreshToken = session.provider_refresh_token;
      const accessToken = session.provider_token;
      const userId = session.user.id;
      const email = session.user.email ?? null;

      if (refreshToken || accessToken) {
        const svc = createServiceSupabase();
        const expiresAt = accessToken
          ? new Date(Date.now() + 50 * 60 * 1000).toISOString()
          : null;
        await svc.from("google_mailbox_credentials").upsert(
          {
            owner_user_id: userId,
            gmail_address: email,
            refresh_token: refreshToken ?? "",
            access_token: accessToken ?? null,
            access_token_expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "owner_user_id" }
        );
      }
    } catch {
      console.error("[auth/callback/exchange] Failed to persist Google mailbox credentials");
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}

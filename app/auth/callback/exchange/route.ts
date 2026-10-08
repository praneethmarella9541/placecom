import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServiceSupabase } from "@/lib/supabase-service";
import {
  ADMIN_USES_GOOGLE_MESSAGE,
  MUST_SET_PASSWORD_KEY,
  SET_PASSWORD_PATH,
} from "@/lib/password-setup";

const MSG_MAX = 450;

function truncateMsg(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Whether this session was created by an emailed link rather than Google. The
 * account's `app_metadata.provider` can't say — it's how the account was first
 * created, not how this session signed in — so read the sign-in method the
 * access token itself carries (`amr`: "otp"/"magiclink" for an emailed link,
 * "oauth" for Google). Without that claim, fall back to Google's tell: an OAuth
 * sign-in comes with provider tokens, a link doesn't.
 */
function signedInViaEmailLink(session: {
  access_token?: string;
  provider_token?: string | null;
  provider_refresh_token?: string | null;
}): boolean {
  try {
    const payload = JSON.parse(
      Buffer.from((session.access_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { amr?: { method?: string; timestamp?: number }[] };
    const latest = [...(payload.amr ?? [])].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
    if (latest?.method) return latest.method === "otp" || latest.method === "magiclink";
  } catch {
    /* fall through to the provider-token check */
  }
  return !session.provider_token && !session.provider_refresh_token;
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

  // The only email link the login page sends is "Forgot password?" — for team
  // members. Coming out of this exchange, an emailed-link session has to choose a
  // new password before it can use anything else (flagged here, enforced in
  // middleware.ts); an admin can't sign in this way at all. If the account can't
  // be checked or flagged, fail closed rather than let the session into the app.
  if (session && signedInViaEmailLink(session)) {
    const refuse = async (message: string) => {
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/?error=auth&msg=${encodeURIComponent(message)}`);
    };
    try {
      const svc = createServiceSupabase();
      const { data: profile } = await svc
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();
      if (profile?.role === "admin") return await refuse(ADMIN_USES_GOOGLE_MESSAGE);

      const { error: flagErr } = await svc.auth.admin.updateUserById(session.user.id, {
        app_metadata: { [MUST_SET_PASSWORD_KEY]: true },
      });
      if (flagErr) throw flagErr;
    } catch (e) {
      console.error("[auth/callback/exchange] Failed to check/flag account for password setup", e);
      return await refuse("Couldn't finish signing you in. Request a new link and try again.");
    }
    return NextResponse.redirect(`${origin}${SET_PASSWORD_PATH}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

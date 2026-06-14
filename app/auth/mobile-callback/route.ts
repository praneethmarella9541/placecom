import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  isAllowedMobileOAuthReturnUri,
  MOBILE_OAUTH_RETURN_COOKIE,
} from "@/lib/mobile-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeJsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "\\u0022").replace(/</g, "\\u003c");
}

/**
 * OAuth redirect target for the mobile app (PKCE).
 * Do NOT exchange the code here — the app calls exchangeCodeForSession().
 *
 * Default: return 200 with ?code= in the URL so openAuthSessionAsync captures it.
 * Cookie / ?return= / handoff=native: also redirect to exp:// or thenucleus://.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const error = searchParams.get("error");
  const description = searchParams.get("error_description") ?? "";

  if (error) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Sign-in failed</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">
<p><strong>Sign-in failed</strong></p>
<p style="color:#666;font-size:14px">${error}${description ? ` — ${description}` : ""}</p>
</body></html>`;
    return new NextResponse(html, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const code = searchParams.get("code");
  if (!code) {
    return new NextResponse("Missing authorization code", { status: 400 });
  }

  const cookieStore = cookies();
  const cookieReturn = cookieStore.get(MOBILE_OAUTH_RETURN_COOKIE)?.value ?? "";
  const queryReturn = searchParams.get("return") ?? "";
  const handoffNative = searchParams.get("handoff") === "native";

  let mobileReturn = "";
  if (isAllowedMobileOAuthReturnUri(cookieReturn)) {
    mobileReturn = cookieReturn;
  } else if (isAllowedMobileOAuthReturnUri(queryReturn)) {
    mobileReturn = queryReturn;
  }

  if (handoffNative && !mobileReturn) {
    mobileReturn = "thenucleus://auth/callback";
  }

  if (mobileReturn) {
    const sep = mobileReturn.includes("?") ? "&" : "?";
    const target = `${mobileReturn}${sep}code=${encodeURIComponent(code)}`;
    const safeTarget = escapeJsString(target);
    const tapHref = target.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Signing in</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">
<p><strong>Signing you in…</strong></p>
<p style="color:#666;font-size:14px">Returning to The Nucleus app.</p>
<p style="margin-top:20px"><a href="${tapHref}" style="color:#1a73e8">Tap here if the app did not open</a></p>
<script>window.location.replace("${safeTarget}");</script>
</body></html>`;

    const response = new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
    if (cookieReturn) {
      response.cookies.set(MOBILE_OAUTH_RETURN_COOKIE, "", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 0,
        path: "/",
      });
    }
    return response;
  }

  // Expo Go primary path: stay on this HTTPS URL with ?code= so the in-app browser
  // returns the full URL to openAuthSessionAsync (no redirect to web or exp).
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Signing in</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">
<p><strong>Signing you in…</strong></p>
<p style="color:#666;font-size:14px">Return to The Nucleus app.</p>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

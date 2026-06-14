import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  isAllowedMobileOAuthReturnUri,
  MOBILE_OAUTH_RETURN_COOKIE,
  mobileOAuthCookieOptions,
} from "@/lib/mobile-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handoffTarget(mobileReturn: string, code: string): string {
  const sep = mobileReturn.includes("?") ? "&" : "?";
  return `${mobileReturn}${sep}code=${encodeURIComponent(code)}`;
}

/**
 * Mobile OAuth landing. Cookie from /auth/mobile-bridge → 302 to exp:// immediately
 * so Expo Go opens and the in-app browser closes. Never web /inbox.
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
  } else if (handoffNative) {
    mobileReturn = "thenucleus://auth/callback";
  }

  if (mobileReturn) {
    const target = handoffTarget(mobileReturn, code);
    const response = NextResponse.redirect(target, {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
    if (cookieReturn) {
      response.cookies.set(
        MOBILE_OAUTH_RETURN_COOKIE,
        "",
        mobileOAuthCookieOptions(0)
      );
    }
    return response;
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Signing in</title>
<meta http-equiv="refresh" content="0;url=about:blank"/></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">
<p><strong>Signing you in…</strong></p>
<p style="color:#666;font-size:14px">Return to The Nucleus app.</p>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

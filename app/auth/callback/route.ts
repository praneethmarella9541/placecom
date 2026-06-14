import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  isAllowedMobileOAuthReturnUri,
  MOBILE_OAUTH_RETURN_COOKIE,
  mobileOAuthCookieOptions,
} from "@/lib/mobile-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildHandoffTarget(mobileReturn: string, code: string): string {
  const sep = mobileReturn.includes("?") ? "&" : "?";
  return `${mobileReturn}${sep}code=${encodeURIComponent(code)}`;
}

/**
 * Web OAuth callback. Mobile cookie present → 302 to app (never web exchange).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const error = searchParams.get("error");
  const description = searchParams.get("error_description") ?? "";
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/inbox";

  if (error) {
    const msg = `${error}${description ? ` — ${description}` : ""}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Sign-in failed</title>
<script>location.replace('/?error=auth&msg=${encodeURIComponent(msg)}');</script></head>
<body><p>Sign-in failed. Redirecting…</p></body></html>`;
    return new NextResponse(html, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (!code) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Sign-in failed</title>
<script>location.replace('/?error=auth&msg=${encodeURIComponent("Missing authorization code")}');</script></head>
<body><p>Missing code. Redirecting…</p></body></html>`;
    return new NextResponse(html, {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const cookieStore = cookies();
  const mobileReturnRaw = cookieStore.get(MOBILE_OAUTH_RETURN_COOKIE)?.value ?? "";
  const mobileReturn = isAllowedMobileOAuthReturnUri(mobileReturnRaw) ? mobileReturnRaw : "";

  if (mobileReturn) {
    const target = buildHandoffTarget(mobileReturn, code);
    const response = NextResponse.redirect(target, {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
    response.cookies.set(MOBILE_OAUTH_RETURN_COOKIE, "", mobileOAuthCookieOptions(0));
    return response;
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Signing in</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">
<p><strong>Signing you in…</strong></p>
<script>location.replace('/auth/callback/exchange?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}');</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

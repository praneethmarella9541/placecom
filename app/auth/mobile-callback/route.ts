import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  isAllowedMobileOAuthReturnUri,
  MOBILE_OAUTH_RETURN_COOKIE,
  mobileOAuthCookieOptions,
} from "@/lib/mobile-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeJsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "\\u0022").replace(/</g, "\\u003c");
}

function handoffTarget(mobileReturn: string, code: string): string {
  const sep = mobileReturn.includes("?") ? "&" : "?";
  return `${mobileReturn}${sep}code=${encodeURIComponent(code)}`;
}

/**
 * Mobile OAuth landing — return 200 with ?code= so openAuthSessionAsync captures
 * the URL and closes the in-app browser. Fallback: delayed JS redirect to exp://.
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

  // This route only exists for the mobile app's OAuth handoff, so when there's
  // no cookie/query signal telling us otherwise, default to the native scheme
  // rather than leaving mobileReturn empty (which would strand the user on
  // this page with no redirect at all — the historical bug here).
  let mobileReturn = "thenucleus://auth/callback";
  if (isAllowedMobileOAuthReturnUri(cookieReturn)) {
    mobileReturn = cookieReturn;
  } else if (isAllowedMobileOAuthReturnUri(queryReturn)) {
    mobileReturn = queryReturn;
  }

  let expFallback = "";
  if (mobileReturn) {
    const target = handoffTarget(mobileReturn, code);
    expFallback = `<script>
setTimeout(function () {
  window.location.replace("${escapeJsString(target)}");
}, 400);
</script>`;
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Signing in</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">
<p><strong>Signing you in…</strong></p>
<p style="color:#666;font-size:14px">Returning to The Nucleus app.</p>
${expFallback}
</body></html>`;

  const response = new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });

  if (cookieReturn) {
    response.cookies.set(MOBILE_OAUTH_RETURN_COOKIE, "", mobileOAuthCookieOptions(0));
  }

  return response;
}

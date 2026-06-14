import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  isAllowedMobileOAuthReturnUri,
  MOBILE_OAUTH_RETURN_COOKIE,
} from "@/lib/mobile-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeJsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\u003c");
}

/**
 * OAuth landing page. Runs in the browser before any server-side exchange.
 *
 * Expo Go: /auth/mobile-bridge sets a cookie; this page hands the code to exp://…
 * so the mobile app can exchange it (web must not steal the code).
 *
 * Web: no cookie → redirect to /auth/callback/exchange for server PKCE.
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

  const safeCode = escapeJsString(code);
  const safeNext = escapeJsString(next);
  const safeMobileReturn = mobileReturn ? escapeJsString(mobileReturn) : "";

  const handoffUrl = mobileReturn
    ? `${mobileReturn}${mobileReturn.includes("?") ? "&" : "?"}code=${encodeURIComponent(code)}`
    : "";
  const safeHandoffHref = handoffUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

  const handoffBlock = mobileReturn
    ? `
  var mobileReturn = '${safeMobileReturn}';
  var sep = mobileReturn.indexOf('?') >= 0 ? '&' : '?';
  var target = mobileReturn + sep + 'code=' + encodeURIComponent(code);
  window.location.replace(target);
  return;`
    : `
  window.location.replace(
    '/auth/callback/exchange?code=' + encodeURIComponent(code) + '&next=' + encodeURIComponent(next)
  );`;

  const tapLink = mobileReturn
    ? `<p style="margin-top:20px"><a href="${safeHandoffHref}" style="color:#1a73e8">Tap here if the app did not open</a></p>`
    : "";

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Signing in</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">
<p><strong>Signing you in…</strong></p>
<p style="color:#666;font-size:14px">Returning to The Nucleus app.</p>
${tapLink}
<script>
(function () {
  var code = '${safeCode}';
  var next = '${safeNext}';
  ${handoffBlock}
})();
</script>
</body></html>`;

  const response = new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });

  if (mobileReturn) {
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

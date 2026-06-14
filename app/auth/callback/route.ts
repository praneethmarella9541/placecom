import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeJsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\u003c");
}

/**
 * OAuth landing page. Runs in the browser before any server-side exchange.
 *
 * Expo Go: /auth/mobile-bridge sets sessionStorage; this page hands the code
 * to exp://… so the mobile app can exchange it (web must not steal the code).
 *
 * Web: no sessionStorage → redirect to /auth/callback/exchange for server PKCE.
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

  const safeCode = escapeJsString(code);
  const safeNext = escapeJsString(next);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Signing in</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">
<p><strong>Signing you in…</strong></p>
<p style="color:#666;font-size:14px">Returning to The Nucleus app.</p>
<script>
(function () {
  var code = '${safeCode}';
  var next = '${safeNext}';
  var mobileReturn = null;
  try { mobileReturn = sessionStorage.getItem('nucleusMobileOAuthReturn'); } catch (e) {}
  if (mobileReturn) {
    try { sessionStorage.removeItem('nucleusMobileOAuthReturn'); } catch (e) {}
    var sep = mobileReturn.indexOf('?') >= 0 ? '&' : '?';
    window.location.href = mobileReturn + sep + 'code=' + encodeURIComponent(code);
    return;
  }
  window.location.replace(
    '/auth/callback/exchange?code=' + encodeURIComponent(code) + '&next=' + encodeURIComponent(next)
  );
})();
</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

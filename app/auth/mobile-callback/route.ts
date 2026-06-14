import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeJsString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\u003c");
}

/**
 * OAuth redirect target for the mobile app (PKCE).
 * Do NOT exchange the code here — the app calls exchangeCodeForSession().
 *
 * Return 200 (not 302) so openAuthSessionAsync / Chrome Custom Tab capture
 * this HTTPS URL with ?code= before any redirect.
 *
 * Expo Go: optional ?return=exp://… lets this page hand off when the auth tab stays open.
 * Native builds: optional ?handoff=native redirects to thenucleus:// after a short delay.
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
<p style="color:#666;font-size:14px">Close this tab and try again in The Nucleus app.</p>
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

  const returnTo = searchParams.get("return");
  const handoffNative = searchParams.get("handoff") === "native";
  const safeCode = escapeJsString(code);
  const safeReturn = returnTo && returnTo.startsWith("exp://") ? escapeJsString(returnTo) : "";

  let script = "";
  if (safeReturn) {
    script = `<script>
(function () {
  var code = '${safeCode}';
  var base = '${safeReturn}';
  var sep = base.indexOf('?') >= 0 ? '&' : '?';
  setTimeout(function () {
    if (document.visibilityState === 'visible') {
      window.location.href = base + sep + 'code=' + encodeURIComponent(code);
    }
  }, 500);
})();
</script>`;
  } else if (handoffNative) {
    script = `<script>
(function () {
  var code = '${safeCode}';
  setTimeout(function () {
    if (document.visibilityState === 'visible') {
      window.location.href = 'thenucleus://auth/callback?code=' + encodeURIComponent(code);
    }
  }, 500);
})();
</script>`;
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Signing in</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;text-align:center">
<p><strong>Signing you in…</strong></p>
<p style="color:#666;font-size:14px">Returning to The Nucleus app.</p>
${script}
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

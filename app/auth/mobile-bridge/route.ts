import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const MOBILE_OAUTH_RETURN_COOKIE = "nucleus_mobile_oauth_return";

function isAllowedReturnUri(value: string): boolean {
  return value.startsWith("exp://") || value.startsWith("thenucleus://");
}

function isSupabaseAuthUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.endsWith(".supabase.co") || host.includes("supabase");
  } catch {
    return false;
  }
}

/**
 * Expo Go entry: persist exp:// return URI in a cookie, then redirect to Supabase OAuth.
 * sessionStorage is unreliable in ephemeral in-app browser sessions.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const returnUri = searchParams.get("return");
  const authUrl = searchParams.get("auth");

  if (!returnUri || !authUrl) {
    return new NextResponse("Missing return or auth parameter", { status: 400 });
  }
  if (!isAllowedReturnUri(returnUri)) {
    return new NextResponse("Invalid return URI", { status: 400 });
  }
  if (!isSupabaseAuthUrl(authUrl)) {
    return new NextResponse("Invalid auth URL", { status: 400 });
  }

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(MOBILE_OAUTH_RETURN_COOKIE, returnUri, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });
  return response;
}

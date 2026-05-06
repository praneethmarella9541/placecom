import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  firstAccessibleWorkspacePath,
  normalizeRestrictedFeatures,
  requestPathToFeature,
} from "@/lib/feature-access";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return supabaseResponse;

  let { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, restricted_features")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr && /restricted_features/i.test(profileErr.message ?? "")) {
    const fallback = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    profile = fallback.data as typeof profile;
    profileErr = fallback.error;
  }
  if (profileErr || !profile) return supabaseResponse;

  if ((profile.role as string) !== "committee") return supabaseResponse;
  const restricted = normalizeRestrictedFeatures(profile.restricted_features);
  if (!restricted.length) return supabaseResponse;

  const feature = requestPathToFeature(
    request.nextUrl.pathname,
    request.nextUrl.searchParams
  );
  if (!feature || !restricted.includes(feature)) return supabaseResponse;

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "This feature is disabled by your admin for committee access." },
      { status: 403 }
    );
  }

  const dest = firstAccessibleWorkspacePath(restricted);
  const url = request.nextUrl.clone();
  const parsed = new URL(dest, request.url);
  if (url.pathname === parsed.pathname && url.search === parsed.search) {
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  url.pathname = parsed.pathname;
  url.search = parsed.search;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

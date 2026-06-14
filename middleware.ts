import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  firstAccessibleWorkspacePath,
  requestPathToFeature,
  type FeatureKey,
} from "@/lib/feature-access";
import { mergeRestrictedFeatures } from "@/lib/profile-access";
import {
  readMiddlewareAccessCache,
  writeMiddlewareAccessCache,
} from "@/lib/middleware-access-cache";

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

  const cached = readMiddlewareAccessCache(request, user.id);
  if (cached?.role === "admin") return supabaseResponse;

  let role = cached?.role ?? "";
  let restricted: FeatureKey[] = cached?.restricted ?? [];
  let groupId = cached?.groupId ?? null;

  if (!cached) {
    let { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role, restricted_features, group_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr && /restricted_features|group_id/i.test(profileErr.message ?? "")) {
      const fallback = await supabase
        .from("profiles")
        .select("role, restricted_features")
        .eq("id", user.id)
        .maybeSingle();
      profile = fallback.data as typeof profile;
      profileErr = fallback.error;
    }
    if (profileErr || !profile) return supabaseResponse;

    role = profile.role as string;
    groupId = (profile.group_id as string | null) ?? null;

    if (role === "admin") {
      writeMiddlewareAccessCache(supabaseResponse, {
        uid: user.id,
        role,
        restricted: [],
        groupId,
      });
      return supabaseResponse;
    }

    let group: { restricted_features: unknown } | null = null;
    if (groupId) {
      const { data: g } = await supabase
        .from("team_groups")
        .select("restricted_features")
        .eq("id", groupId)
        .maybeSingle();
      if (g) group = g as { restricted_features: unknown };
    }

    restricted = mergeRestrictedFeatures(
      {
        role,
        restricted_features: profile.restricted_features,
        group_id: groupId,
      },
      group
    );

    writeMiddlewareAccessCache(supabaseResponse, {
      uid: user.id,
      role,
      restricted,
      groupId,
    });
  }

  if (!restricted.length) return supabaseResponse;

  const feature = requestPathToFeature(
    request.nextUrl.pathname,
    request.nextUrl.searchParams
  );
  if (!feature || !restricted.includes(feature)) return supabaseResponse;

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "This feature is disabled by your admin for your access group." },
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

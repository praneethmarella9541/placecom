import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  FEATURE_KEYS,
  firstAccessibleWorkspacePath,
  getAllowedFeatures,
  requestPathToFeature,
  type FeatureKey,
} from "@/lib/feature-access";
import { mergeRestrictedFeatures } from "@/lib/profile-access";
import {
  readMiddlewareAccessCache,
  writeMiddlewareAccessCache,
} from "@/lib/middleware-access-cache";
import { isConfigsEmailAllowed, isConfigsEnabled, isConfigsPath } from "@/lib/configs-access";
import { disabledFeaturesFromConfig } from "@/lib/module-config";
import { NOT_IN_TEAM_MESSAGE, NO_ACCESS_PATH, isTeamMember } from "@/lib/team-membership";
import {
  MODULE_CONFIG_STALE_COOKIE,
  loadModuleConfig,
} from "@/lib/module-config-store";

/** Public legal pages — no session refresh, no feature-access checks. */
const PUBLIC_PATHS = new Set(["/privacy", "/account-deletion", "/terms"]);

/**
 * Deny a blocked request: JSON 403 for data routes, redirect to the caller's
 * first reachable page for navigations.
 *
 * `blocked` is the union of every gate that applies to this user — platform
 * config, the deployment's feature cap, and their group restrictions — so the
 * redirect never lands on another blocked page and bounce-loops.
 */
function denyFeature(
  request: NextRequest,
  blocked: FeatureKey[],
  message: string
): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status: 403 });
  }
  const dest = firstAccessibleWorkspacePath(blocked);
  const url = request.nextUrl.clone();
  const parsed = new URL(dest, request.url);
  // Everything is blocked (or we are already on the destination) — fall back to
  // the root rather than redirecting a page to itself.
  if (url.pathname === parsed.pathname && url.search === parsed.search) {
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  url.pathname = parsed.pathname;
  url.search = parsed.search;
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

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

  const pathname = request.nextUrl.pathname;

  // /configs is gated on the CONFIGS_ALLOWED_EMAILS allowlist alone — it is not
  // a product module, so it never runs through the feature checks below. This
  // sits ahead of the signed-out early return on purpose: otherwise an
  // anonymous request would fall through and render the page shell.
  if (isConfigsPath(pathname)) {
    if (isConfigsEmailAllowed(user?.email)) return supabaseResponse;
    if (pathname.startsWith("/api/")) {
      // No allowlist configured at all — answer as if the route did not exist
      // rather than confirming there is something here to get access to.
      if (!isConfigsEnabled()) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return user?.id
        ? NextResponse.json(
            { error: "You do not have access to platform configuration." },
            { status: 403 }
          )
        : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (!user?.id) return supabaseResponse;

  // The sign-in page, auth callbacks and the no-access page itself must stay
  // reachable for an account that isn't on a team, or it could never see why
  // it was turned away (or sign out).
  if (pathname === "/" || pathname === NO_ACCESS_PATH || pathname.startsWith("/auth/")) {
    return supabaseResponse;
  }

  const allowed = getAllowedFeatures();

  // Platform module config from /configs — the hard cap above both the
  // deployment cap and group restrictions. Served from a 30s per-instance
  // cache, so this is usually not a round trip.
  //
  // Whoever just saved in /configs carries a cookie holding that write's
  // timestamp; it forces one refetch here so their next click lands on the
  // module they just enabled instead of being redirected by a stale cache.
  // Everyone else converges when the cache expires.
  const writtenAt = Number(request.cookies.get(MODULE_CONFIG_STALE_COOKIE)?.value) || 0;
  const moduleConfig = await loadModuleConfig(supabase, { minFetchedAt: writtenAt });
  const platformDisabled = disabledFeaturesFromConfig(moduleConfig);

  /** Union of every gate that applies to this caller — used for redirect targets. */
  const blockedForRedirect = (groupRestricted: FeatureKey[]): FeatureKey[] => {
    const out = new Set<FeatureKey>([...groupRestricted, ...platformDisabled]);
    if (allowed) {
      for (const k of FEATURE_KEYS as readonly FeatureKey[]) {
        if (!allowed.has(k)) out.add(k);
      }
    }
    return Array.from(out);
  };

  const cached = readMiddlewareAccessCache(request, user.id);
  // Fast path for admins: valid only when nothing above the group level can
  // block a route — no deployment cap, and nothing switched off in /configs.
  if (cached?.role === "admin" && !allowed && !platformDisabled.length) {
    return supabaseResponse;
  }

  let role = cached?.role ?? "";
  let restricted: FeatureKey[] = cached?.restricted ?? [];
  let groupId = cached?.groupId ?? null;

  if (!cached) {
    let { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role, restricted_features, group_id, mailbox_owner_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileErr && /restricted_features|group_id/i.test(profileErr.message ?? "")) {
      const fallback = await supabase
        .from("profiles")
        .select("role, restricted_features, mailbox_owner_id")
        .eq("id", user.id)
        .maybeSingle();
      profile = fallback.data as typeof profile;
      profileErr = fallback.error;
    }
    // A failed lookup says nothing about membership, so don't lock anyone out
    // over it; a *missing* profile or team does.
    if (profileErr) return supabaseResponse;
    if (!isTeamMember(profile)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: NOT_IN_TEAM_MESSAGE, code: "not_in_team" },
          { status: 403 }
        );
      }
      const url = request.nextUrl.clone();
      url.pathname = NO_ACCESS_PATH;
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (!profile) return supabaseResponse;

    role = profile.role as string;
    groupId = (profile.group_id as string | null) ?? null;

    if (role === "admin") {
      writeMiddlewareAccessCache(supabaseResponse, {
        uid: user.id,
        role,
        restricted: [],
        groupId,
      });
      restricted = [];
      // Admins carry no group restrictions, but the deployment cap and /configs
      // still bind them — fall through to those checks rather than returning.
      if (!allowed && !platformDisabled.length) return supabaseResponse;
    } else {
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
  }

  const feature = requestPathToFeature(pathname);
  if (!feature) return supabaseResponse;

  // 1. Platform module config — applies to every role, admins included.
  if (platformDisabled.includes(feature)) {
    return denyFeature(
      request,
      blockedForRedirect(restricted),
      "This module is switched off for this workspace."
    );
  }

  // 2. Deployment-level cap (NEXT_PUBLIC_ALLOWED_FEATURES) — all roles.
  if (allowed && !allowed.has(feature)) {
    return denyFeature(
      request,
      blockedForRedirect(restricted),
      "This feature is not available on this portal."
    );
  }

  // 3. Per-group restrictions set in Admin → Team.
  if (restricted.includes(feature)) {
    return denyFeature(
      request,
      blockedForRedirect(restricted),
      "This feature is disabled by your admin for your access group."
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

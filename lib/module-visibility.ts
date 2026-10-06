"use client";

import { useMemo } from "react";
import {
  FEATURE_KEYS,
  getAllowedFeatures,
  pathToFeature,
  type FeatureKey,
} from "@/lib/feature-access";
import type { MeMailboxResponse } from "@/lib/me-mailbox-types";
import { useMeMailbox } from "@/lib/use-me-mailbox";

/**
 * Single client-side answer to "should this user see this module?", so the
 * three gates stay in agreement with middleware.ts instead of each caller
 * re-deriving them:
 *
 *   /configs disabledModules  →  NEXT_PUBLIC_ALLOWED_FEATURES  →  group restrictions
 *
 * Use this for every cross-module affordance — nav entries, "Add to CRM"
 * buttons, calendar cards inside mail, links from one page into another.
 * Hiding the entry point is not a security boundary (middleware is), but it
 * stops the UI from offering a route that will bounce the user back.
 */

export type VisibilitySource = Pick<
  MeMailboxResponse,
  "restrictedFeatures" | "disabledModules"
>;

/** Every feature hidden from this user, for any reason. */
export function hiddenFeatureSet(me: VisibilitySource | null | undefined): Set<string> {
  const hidden = new Set<string>(me?.restrictedFeatures ?? []);
  for (const m of me?.disabledModules ?? []) hidden.add(m);

  // Deployment cap is a build-time public env var, so it is knowable here and
  // needs no server round trip.
  const allowed = getAllowedFeatures();
  if (allowed) {
    for (const key of FEATURE_KEYS as readonly FeatureKey[]) {
      if (!allowed.has(key)) hidden.add(key);
    }
  }
  return hidden;
}

export function isFeatureVisible(
  me: VisibilitySource | null | undefined,
  feature: FeatureKey
): boolean {
  return !hiddenFeatureSet(me).has(feature);
}

/**
 * Whether an in-app href is reachable. Paths that map to no feature (e.g.
 * /profile, /admin/team) are always reachable.
 */
export function isPathVisible(
  me: VisibilitySource | null | undefined,
  href: string
): boolean {
  const feature = pathToFeature(href);
  if (!feature) return true;
  return !hiddenFeatureSet(me).has(feature);
}

/**
 * Hook form for components. `loaded` is false until the session payload has
 * arrived, which callers should use to avoid flashing an affordance that is
 * about to be hidden.
 */
export function useModuleVisibility(): {
  isVisible: (feature: FeatureKey) => boolean;
  isHrefVisible: (href: string) => boolean;
  loaded: boolean;
} {
  const { me } = useMeMailbox();
  return useMemo(() => {
    const hidden = hiddenFeatureSet(me);
    return {
      isVisible: (feature: FeatureKey) => !hidden.has(feature),
      isHrefVisible: (href: string) => {
        const f = pathToFeature(href);
        return !f || !hidden.has(f);
      },
      loaded: me !== null,
    };
  }, [me]);
}

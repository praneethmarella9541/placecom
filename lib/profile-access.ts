import { normalizeRestrictedFeatures, type FeatureKey } from "@/lib/feature-access";

export type ProfileAccessRow = {
  role?: string | null;
  restricted_features?: unknown;
  group_id?: string | null;
};

export type GroupAccessRow = {
  restricted_features?: unknown;
} | null;

/** Merge blocked features from profile (legacy committee) and assigned group. */
export function mergeRestrictedFeatures(
  profile: ProfileAccessRow,
  group?: GroupAccessRow
): FeatureKey[] {
  if (profile.role === "admin") return [];
  const fromProfile = normalizeRestrictedFeatures(profile.restricted_features);
  const fromGroup = group ? normalizeRestrictedFeatures(group.restricted_features) : [];
  const merged = new Set<FeatureKey>([...fromProfile, ...fromGroup]);
  return Array.from(merged);
}

export function userHasFullAccess(profile: ProfileAccessRow, group?: GroupAccessRow): boolean {
  return mergeRestrictedFeatures(profile, group).length === 0;
}

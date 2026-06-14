/**
 * Session-scoped prefetch for Admin → Team (members, groups, Exotel numbers).
 * Survives navigation so the team page paints instantly from cache, then revalidates.
 */

import type { FeatureKey } from "@/lib/feature-access";
import type { TeamGroup } from "@/components/AdminGroupsPanel";
import { filterAvailableExotelNumbers } from "@/lib/admin-exotel-select";

export type AdminTeamMember = {
  id: string;
  email: string | null;
  displayUsername: string | null;
  jobTitle: string | null;
  bio: string | null;
  role: "staff" | "committee" | string;
  restrictedFeatures: FeatureKey[];
  mobilePhone: string | null;
  exotelVirtualNumber: string | null;
  groupId: string | null;
  groupName: string | null;
  openaiTokenLimit: number | null;
  tokensUsed: number;
};

export type AdminTeamPrefetchSnapshot = {
  members: AdminTeamMember[];
  groups: TeamGroup[];
  /** All configured Exotel lines from the account. */
  configuredExotelNumbers: string[];
  /** Lines already on a profile in Supabase (any admin team). */
  assignedExotelNumbers: string[];
  /** configured minus assigned — used for add-member dropdown. */
  exotelNumbers: string[];
};

let cache: AdminTeamPrefetchSnapshot | null = null;
let inFlight: Promise<AdminTeamPrefetchSnapshot | null> | null = null;

export function getAdminTeamPrefetchCache(): AdminTeamPrefetchSnapshot | null {
  return cache;
}

export function setAdminTeamPrefetchCache(snapshot: AdminTeamPrefetchSnapshot): void {
  cache = snapshot;
}

export function patchAdminTeamPrefetchCache(patch: Partial<AdminTeamPrefetchSnapshot>): void {
  cache = {
    members: patch.members ?? cache?.members ?? [],
    groups: patch.groups ?? cache?.groups ?? [],
    configuredExotelNumbers:
      patch.configuredExotelNumbers ?? cache?.configuredExotelNumbers ?? [],
    assignedExotelNumbers: patch.assignedExotelNumbers ?? cache?.assignedExotelNumbers ?? [],
    exotelNumbers: patch.exotelNumbers ?? cache?.exotelNumbers ?? [],
  };
}

export function clearAdminTeamPrefetchCache(): void {
  cache = null;
  inFlight = null;
}

async function fetchAdminTeamSnapshot(signal?: AbortSignal): Promise<AdminTeamPrefetchSnapshot | null> {
  const [membersRes, groupsRes, exotelRes] = await Promise.all([
    fetch("/api/admin/team-members", { cache: "no-store", signal }),
    fetch("/api/admin/groups", { cache: "no-store", signal }),
    fetch("/api/admin/exotel-numbers", { cache: "no-store", signal }),
  ]);

  if (signal?.aborted) return null;

  let members: AdminTeamMember[] = [];
  let assignedExotelNumbers: string[] = [];
  if (membersRes.ok) {
    const body = (await membersRes.json()) as {
      members?: AdminTeamMember[];
      assignedExotelNumbers?: string[];
    };
    members = body.members ?? [];
    assignedExotelNumbers = body.assignedExotelNumbers ?? [];
  }

  let groups: TeamGroup[] = [];
  if (groupsRes.ok) {
    const body = (await groupsRes.json()) as { groups?: TeamGroup[] };
    groups = body.groups ?? [];
  }

  let configuredExotelNumbers: string[] = [];
  if (exotelRes.ok) {
    const body = (await exotelRes.json()) as { numbers?: string[] };
    configuredExotelNumbers = body.numbers ?? [];
  }

  const exotelNumbers = filterAvailableExotelNumbers(
    configuredExotelNumbers,
    assignedExotelNumbers,
  );

  if (signal?.aborted) return null;

  const snapshot: AdminTeamPrefetchSnapshot = {
    members,
    groups,
    configuredExotelNumbers,
    assignedExotelNumbers,
    exotelNumbers,
  };
  setAdminTeamPrefetchCache(snapshot);
  return snapshot;
}

/** Warm team data in the background (deduped). */
export async function prefetchAdminTeamData(opts?: {
  signal?: AbortSignal;
  force?: boolean;
}): Promise<AdminTeamPrefetchSnapshot | null> {
  if (opts?.signal?.aborted) return null;

  if (!opts?.force && cache) return cache;
  if (!opts?.force && inFlight) return inFlight;

  const run = fetchAdminTeamSnapshot(opts?.signal).finally(() => {
    inFlight = null;
  });

  if (!opts?.force) inFlight = run;
  return run;
}

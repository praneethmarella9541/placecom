import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";
import { getExotelVirtualNumbers } from "@/lib/exotel-numbers";
import { normalizePhone, phoneMatches } from "@/lib/phone";

type AssignedRow = { id: string; exotel_virtual_number: string | null };

async function fetchAllAssignedExotelProfiles(
  svc: ReturnType<typeof createServiceSupabase>,
): Promise<AssignedRow[]> {
  const { data, error } = await svc
    .from("profiles")
    .select("id, exotel_virtual_number")
    .not("exotel_virtual_number", "is", null)
    .neq("exotel_virtual_number", "");

  if (error) {
    console.warn("[admin-exotel-numbers] profiles query failed:", error.message);
    return [];
  }
  return (data ?? []) as AssignedRow[];
}

function isAssignedToOtherMember(
  number: string,
  peers: AssignedRow[],
  forMemberId?: string,
): boolean {
  return peers.some((p) => {
    if (forMemberId && p.id === forMemberId) return false;
    const assigned = p.exotel_virtual_number?.trim();
    return Boolean(assigned && phoneMatches(assigned, number));
  });
}

/** All Exotel lines currently stored on any profile (every admin / team). */
export async function listGloballyAssignedExotelNumbers(): Promise<string[]> {
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return [];
  }
  const rows = await fetchAllAssignedExotelProfiles(svc);
  const out: string[] = [];
  for (const row of rows) {
    const raw = row.exotel_virtual_number?.trim();
    if (!raw) continue;
    const normalized = normalizePhone(raw);
    if (!normalized) continue;
    if (!out.some((n) => phoneMatches(n, normalized))) out.push(normalized);
  }
  return out;
}

/**
 * Configured Exotel lines minus lines already on any profile in Supabase (all admins/teams).
 * When editing, the current member keeps their assigned line in the list.
 */
export async function getAvailableExotelNumbers(
  _adminId: string,
  opts?: { forMemberId?: string },
): Promise<string[]> {
  const configured = await getExotelVirtualNumbers();
  if (configured.length === 0) return [];

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    console.warn("[admin-exotel-numbers] service role unavailable; returning unfiltered list");
    return configured;
  }

  const rows = await fetchAllAssignedExotelProfiles(svc);
  return configured.filter((num) => !isAssignedToOtherMember(num, rows, opts?.forMemberId));
}

/** True when any profile (any admin team) already has this Exotel line. */
export async function isExotelNumberTakenGlobally(
  exotel: string,
  excludeUserId?: string,
): Promise<boolean> {
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return false;
  }
  const rows = await fetchAllAssignedExotelProfiles(svc);
  return isAssignedToOtherMember(exotel, rows, excludeUserId);
}

import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";
import { getExotelVirtualNumbers } from "@/lib/exotel-numbers";
import { phoneMatches } from "@/lib/phone";

type AssignedRow = { id: string; exotel_virtual_number: string | null };

function isAssignedToOtherMember(
  number: string,
  peers: AssignedRow[],
  forMemberId?: string,
): boolean {
  return peers.some((p) => {
    if (forMemberId && p.id === forMemberId) return false;
    return Boolean(p.exotel_virtual_number && phoneMatches(p.exotel_virtual_number, number));
  });
}

/**
 * Configured Exotel lines minus lines already stored on team profiles in Supabase.
 * When editing, the current member keeps their assigned line in the list.
 */
export async function getAvailableExotelNumbers(
  adminId: string,
  opts?: { forMemberId?: string },
): Promise<string[]> {
  const configured = await getExotelVirtualNumbers();
  if (configured.length === 0) return [];

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return configured;
  }

  const { data: peers, error } = await svc
    .from("profiles")
    .select("id, exotel_virtual_number")
    .or(`id.eq.${adminId},mailbox_owner_id.eq.${adminId}`)
    .not("exotel_virtual_number", "is", null);

  if (error) {
    console.warn("[admin-exotel-numbers] profiles query failed:", error.message);
    return configured;
  }

  const rows = (peers ?? []) as AssignedRow[];
  return configured.filter((num) => !isAssignedToOtherMember(num, rows, opts?.forMemberId));
}

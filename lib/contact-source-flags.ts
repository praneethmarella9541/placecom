import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

/**
 * Where a shared contact came from, as the viewer is allowed to know it.
 *
 * Contacts are shared across the org; the mail behind them is not. So the viewer learns that a
 * BYOM mailbox saw an address (`others`) but never whose — only `mine` names the viewer's own.
 */
export type ContactSourceFlags = {
  /** Seen in the org's common mailbox. */
  common: boolean;
  /** Seen in the viewer's own individual mailbox. */
  mine: boolean;
  /** Seen in somebody else's individual mailbox. */
  others: boolean;
};

export type ContactSourceFilter = "all" | "common" | "byom";

export function matchesSourceFilter(flags: ContactSourceFlags | undefined, filter: ContactSourceFilter): boolean {
  if (filter === "all") return true;
  if (!flags) return false;
  return filter === "common" ? flags.common : flags.mine || flags.others;
}

/**
 * email -> flags for the org's contact book. Read with the service role because other people's
 * individual-mailbox rows are hidden from the signed-in role by RLS (migration 0095); this
 * reduces them to a boolean before anything leaves the server.
 */
export async function loadContactSourceFlags(
  orgOwnerId: string,
  viewerId: string
): Promise<Map<string, ContactSourceFlags> | null> {
  const svc = createServiceSupabase();
  const { data: mailboxes, error: mbErr } = await svc
    .from("mailboxes")
    .select("id, mailbox_type")
    .eq("org_owner_id", orgOwnerId);
  if (mbErr) return null; // 0084 not applied
  const commonIds = new Set((mailboxes ?? []).filter((m) => m.mailbox_type === "common").map((m) => m.id as string));

  const { data, error } = await fetchAllRows<{ email: string; mailbox_id: string; owner_user_id: string }>(
    (from, to) =>
      svc
        .from("synced_contact_sources")
        .select("email, mailbox_id, owner_user_id")
        .eq("org_owner_id", orgOwnerId)
        .order("email", { ascending: true })
        .order("mailbox_id", { ascending: true })
        .range(from, to)
  );
  if (error) return null; // 0095 not applied

  const map = new Map<string, ContactSourceFlags>();
  for (const row of data) {
    const flags = map.get(row.email) ?? { common: false, mine: false, others: false };
    if (commonIds.has(row.mailbox_id)) flags.common = true;
    else if (row.owner_user_id === viewerId) flags.mine = true;
    else flags.others = true;
    map.set(row.email, flags);
  }
  return map;
}

/** The org (admin's user id) a signed-in user belongs to; null when they aren't on a team. */
export async function orgOwnerIdForUser(userId: string): Promise<string | null> {
  const { data } = await createServiceSupabase()
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return data.role === "admin" ? userId : ((data.mailbox_owner_id as string | null) ?? null);
}

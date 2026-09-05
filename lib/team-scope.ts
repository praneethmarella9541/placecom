import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase-service";

/**
 * Resolves the admin mailbox/team a user's rows belong to for team-scoped RLS
 * (see 0047/0048 migrations): an admin owns their own team; staff inherit
 * their linked admin's. Returns null if the profile is missing or a staff
 * user isn't linked to an admin yet — callers should still write the row
 * (never drop data on this), just with mailbox_owner_id left null, which
 * means it's visible only to the row's own user_id, not to any admin team
 * view, until the link is fixed.
 */
export async function resolveMailboxOwnerId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return data.role === "admin" ? userId : ((data.mailbox_owner_id as string | null) ?? null);
}

/**
 * Display names for a set of user ids — used to attribute a team-scoped row
 * (a call, a WhatsApp message) to the specific staff member who owns it when
 * an admin is viewing combined team activity. Needs the service role: the
 * caller's own session client can only read its own `profiles` row
 * (profiles_select_own RLS), never a teammate's.
 */
export async function resolveDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return map;
  try {
    const svc = createServiceSupabase();
    const { data } = await svc.from("profiles").select("id, display_username").in("id", ids);
    for (const row of data ?? []) {
      const name = (row.display_username as string | null)?.trim();
      if (name) map.set(row.id as string, name);
    }
  } catch {
    // Service role not configured — attribution is a nice-to-have, never block the timeline on it.
  }
  return map;
}

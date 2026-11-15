import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isResolveMailboxError, requestedMailboxId, resolveMailboxForUser } from "@/lib/mailbox-context";

/**
 * Which contact sync a request drives (BYOM).
 *
 * Every mailbox in an org feeds the org's ONE shared contact book (synced_contacts keyed by the
 * org), but each Gmail account keeps its own progress row in contact_sync_state, keyed by whose
 * account it is. For the common mailbox that is the admin — the same row as before BYOM.
 *
 *  - Working in the common mailbox: needs full access to it (as before for staff).
 *  - Working in your own mailbox: needs SOME access to the common mailbox — the admin granting
 *    it is what makes you part of the shared contact book. Your row is keyed by your user id,
 *    which the org-scoped RLS on contact_sync_state doesn't cover, so it is read and written
 *    with the service role; the code scopes every query by `stateKey` and `poolOwnerId`.
 */

export type ContactSyncTarget =
  | {
      ok: true;
      /** contact_sync_state.mailbox_owner_id: the Gmail account being synced. */
      stateKey: string;
      /** synced_contacts.mailbox_owner_id: the org's contact book. */
      poolOwnerId: string;
      individual: boolean;
      /** The client to read/write this target's sync state with. */
      client: SupabaseClient;
    }
  | { ok: false; status: 403; error: string };

export async function contactSyncTarget(
  request: Request,
  userId: string,
  userClient: SupabaseClient
): Promise<ContactSyncTarget> {
  const svc = createServiceSupabase();
  const { data: profile } = await svc
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", userId)
    .maybeSingle();
  const role = (profile?.role as string) ?? "staff";
  const orgOwnerId = role === "admin" ? userId : ((profile?.mailbox_owner_id as string | null) ?? null);
  if (!orgOwnerId) return { ok: false, status: 403, error: "Your account is not on a team." };

  const resolved = await resolveMailboxForUser(svc, {
    userId,
    role,
    orgOwnerId,
    requestedId: requestedMailboxId(request),
  });
  if (isResolveMailboxError(resolved)) return { ok: false, status: 403, error: resolved.error };

  if (resolved.mailboxType === "individual") {
    if (!resolved.options.some((o) => o.type === "common")) {
      return {
        ok: false,
        status: 403,
        error: "Your admin needs to give you access to the common mailbox before your contacts can join the team's contact book.",
      };
    }
    return { ok: true, stateKey: userId, poolOwnerId: orgOwnerId, individual: true, client: svc };
  }

  if (resolved.access !== "full") {
    return { ok: false, status: 403, error: "Contact sync needs full access to the common mailbox." };
  }
  return { ok: true, stateKey: orgOwnerId, poolOwnerId: orgOwnerId, individual: false, client: userClient };
}

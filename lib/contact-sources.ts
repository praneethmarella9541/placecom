import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase-service";

/**
 * Which mailbox a contact sync is reading, for attribution (BYOM).
 *
 * The org keeps ONE synced_contacts row per email — that is the dedupe. This records, per
 * mailbox, that the address was seen there (synced_contact_sources, migration 0095) so the
 * Contacts page can filter by Common / BYOM and so provenance survives the merge. Contact
 * metadata only: an address, a name's origin, a date and a count — never any mail.
 */
export type SyncSource = {
  mailboxId: string;
  /** The org whose contact book this feeds. */
  orgOwnerId: string;
  /** Whose Gmail it is: the admin for the common mailbox, the staff member for their own. */
  ownerUserId: string;
};

/**
 * The mailbox row behind a contact-sync state key (mailboxes.owner_user_id is unique). Null
 * when BYOM isn't migrated or the account has no mailbox row — attribution is then skipped
 * and the sync behaves exactly as it did before.
 */
export async function resolveSyncSource(
  mailboxOwnerId: string,
  poolOwnerId: string
): Promise<SyncSource | null> {
  try {
    const { data, error } = await createServiceSupabase()
      .from("mailboxes")
      .select("id, org_owner_id, owner_user_id")
      .eq("owner_user_id", mailboxOwnerId)
      .maybeSingle();
    if (error || !data) return null;
    // A mailbox that belongs to a different org than the pool it is feeding is a wiring bug;
    // don't attribute rather than attribute wrongly.
    if ((data.org_owner_id as string) !== poolOwnerId) return null;
    return {
      mailboxId: data.id as string,
      orgOwnerId: data.org_owner_id as string,
      ownerUserId: data.owner_user_id as string,
    };
  } catch {
    return null;
  }
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
/** Same cap as synced_contacts.recent_message_dates (migration 0053). */
const RECENT_DATES_CAP = 300;

export type PageSighting = {
  email: string;
  dates: number[];
  /** A message from this mailbox's own address to them. */
  hasOutbound: boolean;
  /** They wrote it or were addressed directly (not only Cc'd). */
  hasDirect: boolean;
};

/**
 * Folds one page of sightings into this mailbox's source rows: counts add up page by page (as
 * synced_contacts' do), the newest interaction wins, first_seen_at is kept. Best effort — a
 * failure here must never fail the sync, the shared contact row is already written.
 */
export async function recordContactSources(
  supabase: SupabaseClient,
  source: SyncSource,
  sightings: PageSighting[]
): Promise<void> {
  if (sightings.length === 0) return;
  try {
    const emails = sightings.map((s) => s.email);
    const { data: existingRows } = await supabase
      .from("synced_contact_sources")
      .select("email, last_interaction_at, message_count_total, message_count_90d, recent_message_dates, has_outbound_contact, has_direct_contact")
      .eq("mailbox_id", source.mailboxId)
      .in("email", emails);
    const existing = new Map<
      string,
      { lastMs: number; count: number; count90: number; dates: number[]; outbound: boolean; direct: boolean }
    >();
    for (const row of existingRows ?? []) {
      const parsed = row.last_interaction_at ? Date.parse(row.last_interaction_at as string) : 0;
      existing.set(row.email as string, {
        lastMs: Number.isNaN(parsed) ? 0 : parsed,
        count: Number(row.message_count_total ?? 0),
        count90: Number(row.message_count_90d ?? 0),
        dates: Array.isArray(row.recent_message_dates) ? (row.recent_message_dates as number[]) : [],
        outbound: Boolean(row.has_outbound_contact),
        direct: row.has_direct_contact !== false,
      });
    }
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const rows = sightings.map((s) => {
      const prev = existing.get(s.email);
      const lastMs = Math.max(...s.dates, prev?.lastMs ?? 0);
      // Same merge as the shared contact (lib/people-mailbox-sync.ts): the 90-day figure only
      // carries forward while the newest known message is itself inside the window.
      const carried90 = prev && now - prev.lastMs <= NINETY_DAYS_MS ? prev.count90 : 0;
      const mergedDates = Array.from(new Set([...(prev?.dates ?? []), ...s.dates]))
        .sort((a, b) => b - a)
        .slice(0, RECENT_DATES_CAP);
      return {
        mailbox_id: source.mailboxId,
        email: s.email,
        org_owner_id: source.orgOwnerId,
        owner_user_id: source.ownerUserId,
        last_interaction_at: lastMs > 0 ? new Date(lastMs).toISOString() : null,
        message_count_total: (prev?.count ?? 0) + s.dates.length,
        message_count_90d: carried90 + s.dates.filter((d) => now - d <= NINETY_DAYS_MS).length,
        recent_message_dates: mergedDates,
        has_outbound_contact: s.hasOutbound || prev?.outbound === true,
        has_direct_contact: prev ? prev.direct || s.hasDirect : s.hasDirect,
        updated_at: nowIso,
      };
    });
    await supabase.from("synced_contact_sources").upsert(rows, { onConflict: "mailbox_id,email" });
  } catch (e) {
    console.warn("[contact-sources] could not record sources:", e instanceof Error ? e.message : e);
  }
}

/** A fresh backfill of a mailbox recounts it, so clear that mailbox's counts first. */
export async function resetContactSourceCounts(supabase: SupabaseClient, source: SyncSource): Promise<void> {
  try {
    await supabase
      .from("synced_contact_sources")
      .update({ message_count_total: 0, message_count_90d: 0 })
      .eq("mailbox_id", source.mailboxId);
  } catch {
    // best effort
  }
}

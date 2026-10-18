import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How long a claim on a recipient holds before another worker may take it over. Shared by the
 * runner's claim query and the idle check below, which must agree on what "claimable" means.
 */
export const CLAIM_LEASE_SECONDS = 300;

/**
 * Is any email due right now? One cheap head query, answering "should the scheduler wake up?"
 *
 * Kept in its own small file, away from lib/sequence-runner.ts, so the cron endpoint can ask this
 * without loading the whole sender (Gmail, mail-merge, attachments …). An empty tick — the common
 * one — then costs one query instead of a cold load of all that code.
 *
 * Mirrors the runner's claim filter: an active flow, an active recipient, due, and not held by
 * another worker's live lease. A paused flow's recipients do not count, or they would keep every
 * tick awake for nothing.
 */
export async function hasDueSequenceWork(svc: SupabaseClient): Promise<boolean> {
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - CLAIM_LEASE_SECONDS * 1000).toISOString();
  const { count, error } = await svc
    .from("sequence_enrollments")
    .select("id, sequences!inner(status)", { count: "exact", head: true })
    .eq("status", "active")
    .eq("sequences.status", "active")
    .not("next_run_at", "is", null)
    .lte("next_run_at", now.toISOString())
    .or(`claimed_at.is.null,claimed_at.lt.${staleCutoff}`);
  // If the check itself fails, say yes: a wasted full run is better than a missed send.
  if (error) return true;
  return (count ?? 0) > 0;
}

/**
 * Is another worker sending right now? True when a send was started in the last `seconds`.
 *
 * Best effort and deliberately cheap (one row, no new table). The cron answers instantly and keeps
 * sending in the background, so the next minute's tick can arrive while the last one is still
 * working; it should leave the busy one alone instead of starting a second sender beside it.
 * Duplicates are impossible either way — every recipient is leased to one worker — but two
 * workers would double the Gmail quota spent per second.
 */
export async function sequenceSenderRecentlyActive(svc: SupabaseClient, seconds = 20): Promise<boolean> {
  const since = new Date(Date.now() - seconds * 1000).toISOString();
  const { data, error } = await svc
    .from("sequence_sends")
    .select("created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // A failed check must not stall the scheduler: assume nobody is sending.
  if (error) return false;
  return !!data;
}

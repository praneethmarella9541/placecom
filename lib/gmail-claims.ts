import "server-only";

import { createHash } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase-service";

/**
 * Shared notes between server instances (supabase/migrations/0074_gmail_claims.sql),
 * used by the page warmer. Everything here is best effort: if the database is slow
 * or the migration isn't applied, each call answers "no note" and callers carry on —
 * for the warmer that means it simply doesn't run, never that a page fails.
 */

const RPC_TIMEOUT_MS = 800;
let unavailable = false;
let lastWarnAt = 0;

function fail(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const code = (e as { code?: string } | null)?.code ?? "";
  if (code === "PGRST202" || code === "42883" || (/gmail_(bump|claimed|unclaim)/i.test(msg) && /(does not exist|schema cache|not find)/i.test(msg))) {
    unavailable = true;
    console.warn("[gmail-claims] functions missing — page warming is off (apply migration 0074).");
    return;
  }
  if (Date.now() - lastWarnAt > 60_000) {
    lastWarnAt = Date.now();
    console.warn(`[gmail-claims] ${msg}`);
  }
}

/** Keys, so the warmer, the route and the quota module agree on names. */
export const inUseKey = (mailbox: string, token: string) => `use:${mailbox}:${pageId(token)}`;
export const warmKey = (mailbox: string, token: string) => `warm:${mailbox}:${pageId(token)}`;
export const pauseKey = (mailbox: string) => `pause:${mailbox}`;
/** How long warming stays paused after Gmail throttles. */
export const WARM_PAUSE_MS = 10 * 60_000;

/** A short, stable id for a page: its Gmail page token can be very long. */
export function pageId(token: string): string {
  return createHash("sha1").update(token).digest("hex").slice(0, 16);
}

/** Count an event under `key` in a window; returns the count so far (1 = first), or null if the database isn't available. */
export async function bump(key: string, windowMs: number): Promise<number | null> {
  if (unavailable) return null;
  try {
    const { data, error } = await createServiceSupabase()
      .rpc("gmail_bump", { p_key: key, p_window_ms: windowMs })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
    if (error) throw error;
    return Number(data);
  } catch (e) {
    fail(e);
    return null;
  }
}

/** True if any of the keys has an unexpired note. Unknown (database trouble) counts as true — when in doubt, don't warm. */
export async function anyClaimed(keys: string[]): Promise<boolean> {
  if (unavailable) return true;
  try {
    const { data, error } = await createServiceSupabase()
      .rpc("gmail_claimed", { p_keys: keys })
      .abortSignal(AbortSignal.timeout(RPC_TIMEOUT_MS));
    if (error) throw error;
    return Boolean(data);
  } catch (e) {
    fail(e);
    return true;
  }
}

export async function unclaim(key: string): Promise<void> {
  if (unavailable) return;
  try {
    const { error } = await createServiceSupabase().rpc("gmail_unclaim", { p_key: key });
    if (error) throw error;
  } catch (e) {
    fail(e);
  }
}

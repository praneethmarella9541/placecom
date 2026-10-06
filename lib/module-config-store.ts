import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_MODULE_CONFIG,
  normalizeModuleConfig,
  type ModuleConfig,
} from "@/lib/module-config";

/**
 * Reads the singleton platform_module_config row.
 *
 * Deliberately free of "server-only" and of the service-role key: middleware
 * runs on the Edge and reads this on every request with the caller's own
 * Supabase client, which RLS permits (migration 0066 grants select to
 * `authenticated`). Writes are a different path — see /api/configs/modules.
 */

export const MODULE_CONFIG_TABLE = "platform_module_config";

/**
 * Set by /api/configs/modules after a successful write, carrying that write's
 * timestamp. Middleware runs on the Edge while the API route runs on Node, so
 * the write cannot invalidate middleware's cache directly — this cookie lets
 * the next request from whoever saved say "there is a write newer than
 * whatever you cached", which forces one refetch and makes the nav and the
 * gate agree immediately instead of disagreeing for up to TTL_MS.
 *
 * It can only ever cost an extra query: a forged value forces a re-read of the
 * real config, it can never enable a module.
 */
export const MODULE_CONFIG_STALE_COOKIE = "pmc_written_at";
export const MODULE_CONFIG_STALE_MAX_AGE_SEC = 60;

/**
 * Per-instance cache. Each serverless/Edge instance holds its own copy, so a
 * toggle takes effect within TTL_MS everywhere rather than instantly — the
 * trade for not querying Postgres on every single request. Keep it short.
 */
const TTL_MS = 30_000;

let cached: { config: ModuleConfig; at: number } | null = null;

/**
 * `minFetchedAt` lets a caller reject a copy that predates a write it knows
 * about, without shortening TTL_MS for everyone.
 */
export function readCachedModuleConfig(minFetchedAt = 0): ModuleConfig | null {
  if (!cached) return null;
  if (Date.now() - cached.at > TTL_MS) return null;
  if (cached.at < minFetchedAt) return null;
  return cached.config;
}

export function primeModuleConfigCache(config: ModuleConfig): void {
  cached = { config, at: Date.now() };
}

/** Drop this instance's copy — called right after a successful write. */
export function invalidateModuleConfigCache(): void {
  cached = null;
}

/**
 * Current config, from this instance's cache when warm.
 *
 * Falls back to DEFAULT_MODULE_CONFIG when the table is missing (migration 0066
 * not yet applied) or unreadable, so a deployment that is mid-migration keeps
 * behaving exactly as it did before /configs existed instead of flipping every
 * module on.
 */
export async function loadModuleConfig(
  client: SupabaseClient,
  opts?: { minFetchedAt?: number }
): Promise<ModuleConfig> {
  const warm = readCachedModuleConfig(opts?.minFetchedAt ?? 0);
  if (warm) return warm;

  try {
    const { data, error } = await client
      .from(MODULE_CONFIG_TABLE)
      .select("config")
      .eq("id", true)
      .maybeSingle();

    if (error) {
      // Table absent → pre-migration deployment. Cache the default so we do not
      // retry a failing query on every request.
      primeModuleConfigCache(DEFAULT_MODULE_CONFIG);
      return DEFAULT_MODULE_CONFIG;
    }

    // No row yet (table created, seed skipped) — same reasoning as above.
    const config = data ? normalizeModuleConfig(data.config) : DEFAULT_MODULE_CONFIG;
    primeModuleConfigCache(config);
    return config;
  } catch {
    primeModuleConfigCache(DEFAULT_MODULE_CONFIG);
    return DEFAULT_MODULE_CONFIG;
  }
}

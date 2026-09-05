import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { guessCompanyNameFromDomain } from "@/lib/company-name";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

const LOGO_DEV_SEARCH_URL = "https://api.logo.dev/search";

type LogoDevResult = { name?: string; domain?: string; logo_url?: string };
type LogoDevMatch = { name: string; logoUrl: string | null };

/**
 * Queries logo.dev's Search API for a domain — a real domain->company-name
 * database, not string manipulation (unlike guessCompanyNameFromDomain), so it
 * can resolve abbreviations a syntactic guess never could (e.g. "bsci.com" ->
 * "Boston Scientific"). Not infallible: it's fuzzy-matched and occasionally
 * returns a shorter/less-recognizable name than the guess would (e.g.
 * "flsmidth.com" -> "FLS", the company's real ticker/short name, arguably less
 * useful than "Flsmidth"). Treated as best-effort, matching this feature's
 * existing display-only framing — not worth the complexity of second-guessing
 * which result is "more correct". The same response also carries a logo image
 * URL (an img.logo.dev link keyed by the account's public token — safe to embed
 * client-side, that's what a publishable key is for), which we cache alongside
 * the name for the Companies view.
 *
 * Returns null on any failure (missing key, network error, non-2xx, empty
 * results) — callers fall back to the syntactic guess (and no logo).
 */
async function searchLogoDev(domain: string): Promise<LogoDevMatch | null> {
  const key = process.env.LOGO_DEV_SECRET_KEY?.trim();
  if (!key) return null;

  try {
    const res = await fetch(`${LOGO_DEV_SEARCH_URL}?q=${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const results = (await res.json()) as LogoDevResult[];
    const top = results[0];
    const name = top?.name?.trim();
    if (!name) return null;
    return { name, logoUrl: top?.logo_url?.trim() || null };
  } catch {
    return null;
  }
}

/**
 * Resolves a real company name for one domain, checking company_enrichment_cache
 * first so a given domain is only ever looked up once. Always returns a usable
 * name — falls back to guessCompanyNameFromDomain if the API has nothing (and
 * caches that outcome too, as source='guess', so a failing domain isn't retried
 * on every sync). Also caches the logo URL when available — see getAllCachedLogos
 * for reading it back.
 */
export async function resolveCompanyName(svc: SupabaseClient, domain: string): Promise<string> {
  const { data: cached } = await svc
    .from("company_enrichment_cache")
    .select("company_name")
    .eq("domain", domain)
    .maybeSingle();
  if (cached?.company_name) return cached.company_name as string;

  const enriched = await searchLogoDev(domain);
  const name = enriched?.name || guessCompanyNameFromDomain(domain);

  await svc.from("company_enrichment_cache").upsert(
    {
      domain,
      company_name: name,
      logo_url: enriched?.logoUrl ?? null,
      source: enriched ? "logo_dev" : "guess",
      resolved_at: new Date().toISOString(),
    },
    { onConflict: "domain" }
  );

  return name;
}

/**
 * Batch variant for the sync's per-page loop — resolves many distinct domains
 * concurrently (bounded) rather than one at a time, since a 500-message page can
 * easily touch dozens of distinct domains and sequential lookups would add real
 * time to an already-throughput-sensitive sync.
 */
export async function resolveCompanyNames(svc: SupabaseClient, domains: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(domains));
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const concurrency = Math.min(10, unique.length);
  let next = 0;
  async function worker() {
    while (next < unique.length) {
      const i = next++;
      const domain = unique[i];
      result.set(domain, await resolveCompanyName(svc, domain));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}

/**
 * Read-only cache lookup for logos, keyed by domain — no live API calls, used by
 * the Companies list endpoint (a hot read path, unlike the sync's write path
 * above). Fetches the whole cache table (paged — see lib/supabase-fetch-all.ts)
 * rather than filtering by an .in(domains) list, since that list can run into
 * hundreds/thousands of distinct domains and blow past a workable URL length.
 * A domain the sync hasn't resolved yet just won't be in the map — caller falls
 * back to a generic icon until the sync catches up.
 */
export async function getAllCachedLogos(svc: SupabaseClient): Promise<Map<string, string>> {
  const { data } = await fetchAllRows<{ domain: string; logo_url: string | null }>((from, to) =>
    svc.from("company_enrichment_cache").select("domain, logo_url").order("domain", { ascending: true }).range(from, to)
  );
  const result = new Map<string, string>();
  for (const row of data) {
    if (row.logo_url) result.set(row.domain, row.logo_url);
  }
  return result;
}

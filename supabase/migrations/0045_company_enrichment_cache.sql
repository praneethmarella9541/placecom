-- Persistent cache for domain -> real company name lookups (lib/company-enrichment.ts),
-- backing the logo.dev Search API. One row per distinct domain ever seen by the
-- contact sync (lib/people-mailbox-sync.ts) — read before calling the API, written
-- after, so each domain is only ever looked up once rather than on every sync run.
--
-- "guess" rows (source='guess') mean the API call failed or returned nothing for
-- that domain, and lib/company-name.ts's syntactic fallback was used instead —
-- kept in the cache too, so a domain that fails once doesn't get retried forever.

create table if not exists public.company_enrichment_cache (
  domain        text primary key,
  company_name  text not null,
  source        text not null check (source in ('logo_dev', 'guess')),
  resolved_at   timestamptz not null default now()
);

comment on table public.company_enrichment_cache is
  'domain -> real company name cache (logo.dev Search API, falling back to a syntactic guess) — server-only, written by the contact sync.';

alter table public.company_enrichment_cache enable row level security;

drop policy if exists company_enrichment_cache_select_authenticated on public.company_enrichment_cache;
drop policy if exists company_enrichment_cache_write_authenticated on public.company_enrichment_cache;

create policy company_enrichment_cache_select_authenticated on public.company_enrichment_cache
  for select to authenticated using (true);

create policy company_enrichment_cache_write_authenticated on public.company_enrichment_cache
  for all to authenticated using (true) with check (true);

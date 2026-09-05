-- Adds the logo URL logo.dev's Search API already returns alongside the company
-- name (lib/company-enrichment.ts was discarding it) — used by the Companies view
-- to show a real logo instead of a generic building icon.

alter table public.company_enrichment_cache
  add column if not exists logo_url text;

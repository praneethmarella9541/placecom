-- Lusha enrichment: a log of every reveal and search that spends credits, plus per-account settings.
--
-- The log is what makes spending safe and visible: it records who spent how many credits on what,
-- feeds the per-person monthly cap, and keeps what was revealed so a reveal that is not applied to
-- the contact straight away can be applied later without paying for it again.
--
-- Service role only: row-level security is on with no policies, as with integration_connections.

alter table public.integration_connections
  -- Account settings for the connector, e.g. { "perUserMonthlyCap": 200 } (credits; absent = no cap).
  add column if not exists settings jsonb not null default '{}'::jsonb;

create table if not exists public.contact_enrichments (
  id                uuid primary key default gen_random_uuid(),
  mailbox_owner_id  uuid not null references auth.users (id) on delete cascade,
  requested_by      uuid references auth.users (id) on delete set null,
  provider          text not null check (provider in ('lusha')),
  -- The contact the reveal was for. Null for a people search, which is not about one contact.
  contact_id        uuid references public.directory_contacts (id) on delete cascade,
  kind              text not null check (kind in ('reveal', 'search')),
  outcome           text not null check (outcome in ('found', 'not_found', 'partial', 'error')),
  credits_charged   integer not null default 0 check (credits_charged >= 0),
  -- What Lusha returned, reduced to what the workspace uses (emails, phones, title, company, ...).
  revealed          jsonb,
  -- When the person applied it to the contact card; null while it is only a stored result.
  applied_at        timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists contact_enrichments_owner_created_idx
  on public.contact_enrichments (mailbox_owner_id, created_at desc);
create index if not exists contact_enrichments_contact_idx
  on public.contact_enrichments (contact_id, created_at desc);
create index if not exists contact_enrichments_user_month_idx
  on public.contact_enrichments (requested_by, created_at);

comment on table public.contact_enrichments is
  'Lusha reveals and searches: who spent which credits on what, and what came back. Service role only.';

alter table public.contact_enrichments enable row level security;

-- People auto-derived from the shared team mailbox (see lib/people-mailbox-sync.ts).
-- Separate from directory_contacts (the hand-curated card list) — this table is
-- fully re-derivable from a mailbox sync, upserted by email, shared org-wide since
-- every user's "sync" reads the same shared inbox (lib/gmail-auth.ts).

create table if not exists public.synced_contacts (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null unique,
  display_name         text,
  domain               text,
  company_name         text,
  last_interaction_at  timestamptz,
  connection_strength  text
    check (connection_strength in ('Good', 'Weak', 'Very weak', 'No communication')),
  message_count_90d    int not null default 0,
  message_count_total  int not null default 0,
  synced_at            timestamptz,
  synced_by            uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.synced_contacts is
  'Auto-populated from the shared mailbox (bucketed by email connection strength) — read-only in the UI, not manually edited.';

alter table public.synced_contacts enable row level security;

drop policy if exists synced_contacts_select_authenticated on public.synced_contacts;
drop policy if exists synced_contacts_write_authenticated on public.synced_contacts;

create policy synced_contacts_select_authenticated on public.synced_contacts
  for select to authenticated using (true);

create policy synced_contacts_write_authenticated on public.synced_contacts
  for all to authenticated using (true) with check (true);

create index if not exists synced_contacts_connection_strength_idx on public.synced_contacts (connection_strength);
create index if not exists synced_contacts_last_interaction_idx on public.synced_contacts (last_interaction_at desc);

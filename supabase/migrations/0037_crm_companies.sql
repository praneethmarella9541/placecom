-- Companies CRM, auto-populated from the connected Gmail mailbox (see lib/company-mailbox-sync.ts).
-- Lives alongside the existing leads/lead_interactions Kanban — not a replacement.

create table if not exists public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null,
  company_name text not null,
  first_seen_at timestamptz,
  last_interaction_at timestamptz,
  connection_strength text
    check (connection_strength in ('Good', 'Weak', 'Very weak', 'No communication')),
  message_count_90d int not null default 0,
  message_count_total int not null default 0,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, domain)
);

create table if not exists public.crm_company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  last_interaction_at timestamptz,
  message_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email)
);

create table if not exists public.crm_company_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists crm_companies_user_id_idx on public.crm_companies (user_id);
create index if not exists crm_companies_domain_idx on public.crm_companies (user_id, domain);
create index if not exists crm_companies_last_interaction_idx on public.crm_companies (user_id, last_interaction_at desc);
create index if not exists crm_company_contacts_company_id_idx on public.crm_company_contacts (company_id);
create index if not exists crm_company_notes_company_id_idx on public.crm_company_notes (company_id);

alter table public.crm_companies enable row level security;
alter table public.crm_company_contacts enable row level security;
alter table public.crm_company_notes enable row level security;

create policy "crm_companies_select_own" on public.crm_companies for select using (auth.uid() = user_id);
create policy "crm_companies_insert_own" on public.crm_companies for insert with check (auth.uid() = user_id);
create policy "crm_companies_update_own" on public.crm_companies for update using (auth.uid() = user_id);
create policy "crm_companies_delete_own" on public.crm_companies for delete using (auth.uid() = user_id);

create policy "crm_company_contacts_select_own" on public.crm_company_contacts for select using (auth.uid() = user_id);
create policy "crm_company_contacts_insert_own" on public.crm_company_contacts for insert with check (auth.uid() = user_id);
create policy "crm_company_contacts_update_own" on public.crm_company_contacts for update using (auth.uid() = user_id);
create policy "crm_company_contacts_delete_own" on public.crm_company_contacts for delete using (auth.uid() = user_id);

create policy "crm_company_notes_select_own" on public.crm_company_notes for select using (auth.uid() = user_id);
create policy "crm_company_notes_insert_own" on public.crm_company_notes for insert with check (auth.uid() = user_id);
create policy "crm_company_notes_update_own" on public.crm_company_notes for update using (auth.uid() = user_id);
create policy "crm_company_notes_delete_own" on public.crm_company_notes for delete using (auth.uid() = user_id);

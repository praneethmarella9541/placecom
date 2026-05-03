create type lead_stage as enum ('Awareness', 'Engagement', 'Conversion', 'Retention');
create type lead_score as enum ('Hot', 'Warm', 'Cold');

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  staff_name text not null default 'Unassigned',
  company_name text not null,
  contact_name text,
  email text,
  phone text,
  stage lead_stage not null default 'Awareness',
  score lead_score not null default 'Warm',
  stage_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  interaction_type text not null check (interaction_type in ('Call', 'Email', 'Meeting', 'Note')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists leads_user_id_idx on public.leads (user_id);
create index if not exists lead_interactions_lead_id_idx on public.lead_interactions (lead_id);

alter table public.leads enable row level security;
alter table public.lead_interactions enable row level security;

create policy "leads_select_own" on public.leads for select using (auth.uid() = user_id);
create policy "leads_insert_own" on public.leads for insert with check (auth.uid() = user_id);
create policy "leads_update_own" on public.leads for update using (auth.uid() = user_id);
create policy "leads_delete_own" on public.leads for delete using (auth.uid() = user_id);

create policy "lead_interactions_select_own" on public.lead_interactions for select using (auth.uid() = user_id);
create policy "lead_interactions_insert_own" on public.lead_interactions for insert with check (auth.uid() = user_id);
create policy "lead_interactions_update_own" on public.lead_interactions for update using (auth.uid() = user_id);
create policy "lead_interactions_delete_own" on public.lead_interactions for delete using (auth.uid() = user_id);

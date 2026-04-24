-- Run in Supabase SQL editor or via CLI

create table if not exists public.extraction_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  total_emails int not null default 0,
  processed_emails int not null default 0,
  created_at timestamptz not null default now(),
  constraint extraction_jobs_status_check check (
    status in ('pending', 'running', 'done', 'error')
  )
);

create table if not exists public.email_extractions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.extraction_jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email_id text not null,
  subject text,
  body text,
  sender text,
  extracted_names jsonb not null default '[]'::jsonb,
  extracted_phones jsonb not null default '[]'::jsonb,
  extracted_emails jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists email_extractions_user_id_created_at_idx
  on public.email_extractions (user_id, created_at desc);

create index if not exists extraction_jobs_user_id_created_at_idx
  on public.extraction_jobs (user_id, created_at desc);

alter table public.extraction_jobs enable row level security;
alter table public.email_extractions enable row level security;

create policy "extraction_jobs_select_own"
  on public.extraction_jobs for select
  using (auth.uid() = user_id);

create policy "extraction_jobs_insert_own"
  on public.extraction_jobs for insert
  with check (auth.uid() = user_id);

create policy "extraction_jobs_update_own"
  on public.extraction_jobs for update
  using (auth.uid() = user_id);

create policy "extraction_jobs_delete_own"
  on public.extraction_jobs for delete
  using (auth.uid() = user_id);

create policy "email_extractions_select_own"
  on public.email_extractions for select
  using (auth.uid() = user_id);

create policy "email_extractions_insert_own"
  on public.email_extractions for insert
  with check (auth.uid() = user_id);

create policy "email_extractions_update_own"
  on public.email_extractions for update
  using (auth.uid() = user_id);

create policy "email_extractions_delete_own"
  on public.email_extractions for delete
  using (auth.uid() = user_id);

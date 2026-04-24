create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  call_sid text not null unique,
  to_number text not null,
  from_number text not null,
  agent_number text not null,
  company_name text,
  notes text,
  status text not null default 'queued',
  duration_seconds int,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists call_logs_user_id_created_at_idx
  on public.call_logs (user_id, created_at desc);

alter table public.call_logs enable row level security;

create policy "call_logs_select_own"
  on public.call_logs for select
  using (auth.uid() = user_id);

create policy "call_logs_insert_own"
  on public.call_logs for insert
  with check (auth.uid() = user_id);

create policy "call_logs_update_own"
  on public.call_logs for update
  using (auth.uid() = user_id);

create policy "call_logs_delete_own"
  on public.call_logs for delete
  using (auth.uid() = user_id);

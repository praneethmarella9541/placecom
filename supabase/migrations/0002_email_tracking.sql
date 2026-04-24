-- Email read tracking via tracking pixel

create table if not exists public.email_tracking (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  gmail_message_id text not null,
  to_address text not null,
  subject text,
  sent_at timestamptz not null default now(),
  opened boolean not null default false,
  opened_at timestamptz,
  open_count int not null default 0
);

create index if not exists email_tracking_user_id_sent_at_idx
  on public.email_tracking (user_id, sent_at desc);

create index if not exists email_tracking_gmail_message_id_idx
  on public.email_tracking (gmail_message_id);

alter table public.email_tracking enable row level security;

-- Users can read their own tracking rows
create policy "email_tracking_select_own"
  on public.email_tracking for select
  using (auth.uid() = user_id);

-- Users can insert their own tracking rows
create policy "email_tracking_insert_own"
  on public.email_tracking for insert
  with check (auth.uid() = user_id);

-- Users can delete their own tracking rows
create policy "email_tracking_delete_own"
  on public.email_tracking for delete
  using (auth.uid() = user_id);

-- The tracking pixel endpoint uses service_role to update, so no RLS update policy needed for anon.
-- service_role bypasses RLS entirely.

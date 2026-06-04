-- Mobile push tokens (Expo) and Gmail history cursor for mail notifications.

create table if not exists public.push_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create index if not exists push_device_tokens_user_id_idx
  on public.push_device_tokens (user_id);

alter table public.push_device_tokens enable row level security;

create policy push_device_tokens_select_own on public.push_device_tokens
  for select to authenticated using (user_id = auth.uid());

create policy push_device_tokens_insert_own on public.push_device_tokens
  for insert to authenticated with check (user_id = auth.uid());

create policy push_device_tokens_update_own on public.push_device_tokens
  for update to authenticated using (user_id = auth.uid());

create policy push_device_tokens_delete_own on public.push_device_tokens
  for delete to authenticated using (user_id = auth.uid());

comment on table public.push_device_tokens is
  'Expo push tokens for The Nucleus mobile app (WhatsApp + mail alerts).';

-- One cursor per shared Gmail mailbox (admin owner id).
create table if not exists public.gmail_push_state (
  mailbox_owner_id uuid primary key references auth.users (id) on delete cascade,
  last_history_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.gmail_push_state enable row level security;

comment on table public.gmail_push_state is
  'Gmail historyId cursor for cron mail push (service role only; no RLS policies).';

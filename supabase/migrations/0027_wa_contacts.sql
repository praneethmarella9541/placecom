-- Per-user WhatsApp contact names.
-- Each staff member can save a display name for any phone number they chat with.

create table if not exists public.wa_contacts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  peer_e164   text not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, peer_e164)
);

alter table public.wa_contacts enable row level security;

-- Users can only read/write their own contacts
create policy "wa_contacts_select_own" on public.wa_contacts
  for select using (auth.uid() = user_id);

create policy "wa_contacts_insert_own" on public.wa_contacts
  for insert with check (auth.uid() = user_id);

create policy "wa_contacts_update_own" on public.wa_contacts
  for update using (auth.uid() = user_id);

create policy "wa_contacts_delete_own" on public.wa_contacts
  for delete using (auth.uid() = user_id);

create index if not exists wa_contacts_user_id_idx on public.wa_contacts (user_id);

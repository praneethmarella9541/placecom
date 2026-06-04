-- Per-user last-read cursor for WhatsApp threads (unread badge counts).

create table if not exists public.wa_thread_reads (
  user_id     uuid not null references auth.users (id) on delete cascade,
  peer_e164   text not null,
  read_at     timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, peer_e164)
);

alter table public.wa_thread_reads enable row level security;

create policy "wa_thread_reads_select_own" on public.wa_thread_reads
  for select using (auth.uid() = user_id);

create policy "wa_thread_reads_insert_own" on public.wa_thread_reads
  for insert with check (auth.uid() = user_id);

create policy "wa_thread_reads_update_own" on public.wa_thread_reads
  for update using (auth.uid() = user_id);

create policy "wa_thread_reads_delete_own" on public.wa_thread_reads
  for delete using (auth.uid() = user_id);

create index if not exists wa_thread_reads_user_id_idx on public.wa_thread_reads (user_id);

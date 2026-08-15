-- Singleton cursor for the shared-mailbox people sync (lib/people-mailbox-sync.ts).
-- One row: there's one shared team mailbox (lib/gmail-auth.ts), so one sync cursor,
-- not per-user. Tracks a resumable full-mailbox backfill (paged, no message cap),
-- then switches to fast incremental (after:<date>) syncs once backfill completes.

create table if not exists public.contact_sync_state (
  id                            int primary key default 1,
  status                        text not null default 'idle'
    check (status in ('idle', 'running', 'error')),
  phase                         text check (phase in ('backfill', 'incremental')),
  page_token                    text,
  oldest_scanned_internal_date  bigint,
  newest_scanned_internal_date  bigint,
  messages_scanned_total        bigint not null default 0,
  contacts_found_total          int not null default 0,
  last_progress                 jsonb,
  last_summary                  text,
  started_at                    timestamptz,
  updated_at                    timestamptz not null default now(),
  completed_backfill_at         timestamptz,
  error_message                 text,
  constraint contact_sync_state_singleton check (id = 1)
);

insert into public.contact_sync_state (id) values (1) on conflict (id) do nothing;

comment on table public.contact_sync_state is
  'Singleton progress cursor for the resumable shared-mailbox contact sync — one row, id=1.';

alter table public.contact_sync_state enable row level security;

drop policy if exists contact_sync_state_select_authenticated on public.contact_sync_state;
drop policy if exists contact_sync_state_update_authenticated on public.contact_sync_state;

create policy contact_sync_state_select_authenticated on public.contact_sync_state
  for select to authenticated using (true);

create policy contact_sync_state_update_authenticated on public.contact_sync_state
  for update to authenticated using (true) with check (true);

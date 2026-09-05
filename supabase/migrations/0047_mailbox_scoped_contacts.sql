-- Scopes contacts to the admin mailbox they came from, instead of one org-wide
-- pool. Today directory_contacts/synced_contacts are readable by every signed-in
-- user regardless of which admin's Gmail their account is linked to
-- (profiles.mailbox_owner_id) — so e.g. a staff user linked to admin A can see
-- contacts synced from admin B's inbox. This adds mailbox_owner_id to both
-- tables (and to contact_sync_state, previously a single id=1 row shared by
-- every admin's sync progress) and scopes RLS so each admin + their linked
-- staff only see their own mailbox's contacts.

-- Resolves the effective mailbox owner for the calling user: an admin owns
-- their own contacts; staff inherit their linked admin's. security definer so
-- it can read profiles regardless of the caller's own RLS grants (reading
-- one's own profile row is already allowed, but this keeps the policies below
-- simple and avoids re-deriving this in every policy).
create or replace function public.current_mailbox_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when p.role = 'admin' then p.id else p.mailbox_owner_id end
  from public.profiles p
  where p.id = auth.uid()
$$;

grant execute on function public.current_mailbox_owner_id() to authenticated;

-- ---------------------------------------------------------------------------
-- synced_contacts: add owner column, best-effort backfill from synced_by
-- (the user who ran that sync — their effective mailbox owner at the time),
-- re-key uniqueness per owner instead of globally per email.
-- ---------------------------------------------------------------------------

alter table public.synced_contacts
  add column if not exists mailbox_owner_id uuid references auth.users (id) on delete cascade;

update public.synced_contacts sc
set mailbox_owner_id = (
  select case when p.role = 'admin' then p.id else p.mailbox_owner_id end
  from public.profiles p
  where p.id = sc.synced_by
)
where sc.mailbox_owner_id is null and sc.synced_by is not null;

-- Rows synced under an account since deleted/unlinked have no way to resolve
-- an owner — orphaned rows would become invisible to everyone under the
-- scoped policy below (better than defaulting them to one admin and leaking
-- them into that admin's directory). They naturally get re-created by that
-- mailbox's next sync.
delete from public.synced_contacts where mailbox_owner_id is null;

alter table public.synced_contacts alter column mailbox_owner_id set not null;

alter table public.synced_contacts drop constraint if exists synced_contacts_email_key;
create unique index if not exists synced_contacts_owner_email_key
  on public.synced_contacts (mailbox_owner_id, email);

create index if not exists synced_contacts_mailbox_owner_idx on public.synced_contacts (mailbox_owner_id);

drop policy if exists synced_contacts_select_authenticated on public.synced_contacts;
drop policy if exists synced_contacts_write_authenticated on public.synced_contacts;

create policy synced_contacts_select_scoped on public.synced_contacts
  for select to authenticated using (mailbox_owner_id = public.current_mailbox_owner_id());

create policy synced_contacts_write_scoped on public.synced_contacts
  for all to authenticated
  using (mailbox_owner_id = public.current_mailbox_owner_id())
  with check (mailbox_owner_id = public.current_mailbox_owner_id());

comment on column public.synced_contacts.mailbox_owner_id is
  'Admin whose Gmail this contact was synced from (auth.users id) — scopes visibility to that admin + their linked staff.';

-- ---------------------------------------------------------------------------
-- directory_contacts: same treatment, backfilled from created_by.
-- ---------------------------------------------------------------------------

alter table public.directory_contacts
  add column if not exists mailbox_owner_id uuid references auth.users (id) on delete cascade;

update public.directory_contacts dc
set mailbox_owner_id = (
  select case when p.role = 'admin' then p.id else p.mailbox_owner_id end
  from public.profiles p
  where p.id = dc.created_by
)
where dc.mailbox_owner_id is null and dc.created_by is not null;

-- Cards with no resolvable creator (created_by null'd out by an old deletion,
-- or the creator's account is gone) fall back to whichever admin has the most
-- mailbox-linked staff — a reasonable "most likely team" guess rather than
-- deleting hand-entered data outright.
update public.directory_contacts
set mailbox_owner_id = (
  select p.id from public.profiles p
  where p.role = 'admin'
  order by (select count(*) from public.profiles s where s.mailbox_owner_id = p.id) desc, p.id
  limit 1
)
where mailbox_owner_id is null;

alter table public.directory_contacts alter column mailbox_owner_id set not null;

create index if not exists directory_contacts_mailbox_owner_idx on public.directory_contacts (mailbox_owner_id);

drop policy if exists directory_contacts_select_authenticated on public.directory_contacts;
drop policy if exists directory_contacts_insert_authenticated on public.directory_contacts;
drop policy if exists directory_contacts_update_authenticated on public.directory_contacts;
drop policy if exists directory_contacts_delete_authenticated on public.directory_contacts;

create policy directory_contacts_select_scoped on public.directory_contacts
  for select to authenticated using (mailbox_owner_id = public.current_mailbox_owner_id());

create policy directory_contacts_insert_scoped on public.directory_contacts
  for insert to authenticated
  with check (auth.uid() = created_by and mailbox_owner_id = public.current_mailbox_owner_id());

create policy directory_contacts_update_scoped on public.directory_contacts
  for update to authenticated
  using (mailbox_owner_id = public.current_mailbox_owner_id())
  with check (mailbox_owner_id = public.current_mailbox_owner_id());

create policy directory_contacts_delete_scoped on public.directory_contacts
  for delete to authenticated using (mailbox_owner_id = public.current_mailbox_owner_id());

comment on column public.directory_contacts.mailbox_owner_id is
  'Admin team this hand-added card belongs to (set from the creator''s effective mailbox owner) — scopes visibility.';

-- ---------------------------------------------------------------------------
-- contact_sync_state: was a single id=1 row shared by every admin's sync —
-- already-live multi-admin syncs were stomping each other's cursor. Re-key
-- to one row per mailbox owner. Existing progress can't be attributed to a
-- single owner reliably (it was being overwritten by whichever mailbox last
-- ran a sync), so it's cleared; every mailbox does one fresh backfill next
-- time its "Sync from Mailbox" runs (or the next cron tick for the mailbox
-- CONTACT_SYNC_MAILBOX_OWNER_ID targets).
-- ---------------------------------------------------------------------------

delete from public.contact_sync_state;

alter table public.contact_sync_state drop constraint if exists contact_sync_state_singleton;
alter table public.contact_sync_state add column if not exists mailbox_owner_id uuid references auth.users (id) on delete cascade;
alter table public.contact_sync_state drop constraint if exists contact_sync_state_pkey;
alter table public.contact_sync_state drop column if exists id;
alter table public.contact_sync_state alter column mailbox_owner_id set not null;
alter table public.contact_sync_state add primary key (mailbox_owner_id);

comment on table public.contact_sync_state is
  'Per-mailbox progress cursor for the resumable contact sync — one row per admin mailbox owner (see lib/people-mailbox-sync.ts).';

drop policy if exists contact_sync_state_select_authenticated on public.contact_sync_state;
drop policy if exists contact_sync_state_update_authenticated on public.contact_sync_state;

create policy contact_sync_state_select_scoped on public.contact_sync_state
  for select to authenticated using (mailbox_owner_id = public.current_mailbox_owner_id());

create policy contact_sync_state_write_scoped on public.contact_sync_state
  for all to authenticated
  using (mailbox_owner_id = public.current_mailbox_owner_id())
  with check (mailbox_owner_id = public.current_mailbox_owner_id());

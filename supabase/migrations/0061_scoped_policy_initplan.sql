-- Evaluate current_mailbox_owner_id() once per query instead of once per row.
--
-- 0047 scoped synced_contacts/directory_contacts/contact_sync_state with
-- `mailbox_owner_id = public.current_mailbox_owner_id()`. Written that way the
-- helper is an ordinary function call in the row filter, so Postgres re-runs it
-- for every row it considers — and it is `security definer` over profiles, so
-- each of those is a lookup of its own. On synced_contacts that is now ~9.7k
-- rows for one mailbox and ~38.6k for the other, on every page of every read.
--
-- Wrapping it in a scalar subquery makes it an InitPlan: evaluated once, then
-- compared as a constant. Same rule, same visibility, no behaviour change.
-- 0036 already writes the sequences policies this way; these predate it.

-- synced_contacts ------------------------------------------------------------

drop policy if exists synced_contacts_select_scoped on public.synced_contacts;
drop policy if exists synced_contacts_write_scoped on public.synced_contacts;

create policy synced_contacts_select_scoped on public.synced_contacts
  for select to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()));

create policy synced_contacts_write_scoped on public.synced_contacts
  for all to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()))
  with check (mailbox_owner_id = (select public.current_mailbox_owner_id()));

-- directory_contacts ---------------------------------------------------------

drop policy if exists directory_contacts_select_scoped on public.directory_contacts;
drop policy if exists directory_contacts_insert_scoped on public.directory_contacts;
drop policy if exists directory_contacts_update_scoped on public.directory_contacts;
drop policy if exists directory_contacts_delete_scoped on public.directory_contacts;

create policy directory_contacts_select_scoped on public.directory_contacts
  for select to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()));

-- Unchanged from 0047 apart from the wrap: a card still has to be created by
-- the caller *and* land in their own mailbox's scope.
create policy directory_contacts_insert_scoped on public.directory_contacts
  for insert to authenticated
  with check (
    auth.uid() = created_by
    and mailbox_owner_id = (select public.current_mailbox_owner_id())
  );

create policy directory_contacts_update_scoped on public.directory_contacts
  for update to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()))
  with check (mailbox_owner_id = (select public.current_mailbox_owner_id()));

create policy directory_contacts_delete_scoped on public.directory_contacts
  for delete to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()));

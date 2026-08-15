-- Extends the mailbox-team scoping model from 0047 (contacts) to WhatsApp
-- messages, call logs, and CRM leads/interactions.
--
-- Target model, same for all four tables: a staff member (B or C) sees only
-- their own rows (user_id = auth.uid()); their admin (A) sees every row
-- belonging to their whole team (mailbox_owner_id = A's id), including B's
-- and C's; a different admin's team is fully isolated — no cross-admin
-- pollution. Uses public.current_mailbox_owner_id() from 0047.
--
-- Unlike directory_contacts/synced_contacts, mailbox_owner_id here is left
-- NULLABLE: this is live operational data (calls, WhatsApp messages, leads)
-- written continuously by webhooks and background jobs, and a resolution
-- edge case (e.g. INCOMING_DEFAULT_USER_ID has no team) must never block an
-- insert. A null mailbox_owner_id row is simply invisible to any admin's
-- team view until re-linked — it's still visible to its own user_id.
--
-- Write policies (insert/update/delete) are untouched — still own-row-only
-- everywhere; only SELECT visibility changes.

-- ---------------------------------------------------------------------------
-- whatsapp_messages
-- ---------------------------------------------------------------------------

alter table public.whatsapp_messages
  add column if not exists mailbox_owner_id uuid references auth.users (id) on delete set null;

update public.whatsapp_messages wm
set mailbox_owner_id = (
  select case when p.role = 'admin' then p.id else p.mailbox_owner_id end
  from public.profiles p
  where p.id = wm.user_id
)
where wm.mailbox_owner_id is null and wm.user_id is not null;

create index if not exists whatsapp_messages_mailbox_owner_idx on public.whatsapp_messages (mailbox_owner_id);

drop policy if exists whatsapp_messages_select_authenticated on public.whatsapp_messages;
drop policy if exists whatsapp_messages_select_scoped on public.whatsapp_messages;

create policy whatsapp_messages_select_scoped on public.whatsapp_messages
  for select to authenticated using (
    user_id = auth.uid()
    or (mailbox_owner_id = auth.uid() and public.current_mailbox_owner_id() = auth.uid())
  );

comment on column public.whatsapp_messages.mailbox_owner_id is
  'Admin team the owning line (user_id) belongs to — lets that admin see this row alongside their own; nullable, see 0048 migration note.';

-- ---------------------------------------------------------------------------
-- call_logs
-- ---------------------------------------------------------------------------

alter table public.call_logs
  add column if not exists mailbox_owner_id uuid references auth.users (id) on delete set null;

update public.call_logs cl
set mailbox_owner_id = (
  select case when p.role = 'admin' then p.id else p.mailbox_owner_id end
  from public.profiles p
  where p.id = cl.user_id
)
where cl.mailbox_owner_id is null;

create index if not exists call_logs_mailbox_owner_idx on public.call_logs (mailbox_owner_id);

drop policy if exists call_logs_select_shared on public.call_logs;
drop policy if exists "call_logs_select_own" on public.call_logs;
drop policy if exists call_logs_select_scoped on public.call_logs;

create policy call_logs_select_scoped on public.call_logs
  for select to authenticated using (
    user_id = auth.uid()
    or (mailbox_owner_id = auth.uid() and public.current_mailbox_owner_id() = auth.uid())
  );

comment on column public.call_logs.mailbox_owner_id is
  'Admin team the logging user belongs to — lets that admin see this call alongside their own; nullable, see 0048 migration note.';

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists mailbox_owner_id uuid references auth.users (id) on delete set null;

update public.leads l
set mailbox_owner_id = (
  select case when p.role = 'admin' then p.id else p.mailbox_owner_id end
  from public.profiles p
  where p.id = l.user_id
)
where l.mailbox_owner_id is null;

create index if not exists leads_mailbox_owner_idx on public.leads (mailbox_owner_id);

drop policy if exists leads_select_shared on public.leads;
drop policy if exists "leads_select_own" on public.leads;
drop policy if exists leads_select_scoped on public.leads;

create policy leads_select_scoped on public.leads
  for select to authenticated using (
    user_id = auth.uid()
    or (mailbox_owner_id = auth.uid() and public.current_mailbox_owner_id() = auth.uid())
  );

comment on column public.leads.mailbox_owner_id is
  'Admin team the owning user belongs to — lets that admin see this lead alongside their own; nullable, see 0048 migration note.';

-- ---------------------------------------------------------------------------
-- lead_interactions — same treatment, wasn't touched by the earlier org-wide
-- widening (0041) but should follow the same model as its parent leads row.
-- ---------------------------------------------------------------------------

alter table public.lead_interactions
  add column if not exists mailbox_owner_id uuid references auth.users (id) on delete set null;

update public.lead_interactions li
set mailbox_owner_id = (
  select case when p.role = 'admin' then p.id else p.mailbox_owner_id end
  from public.profiles p
  where p.id = li.user_id
)
where li.mailbox_owner_id is null;

create index if not exists lead_interactions_mailbox_owner_idx on public.lead_interactions (mailbox_owner_id);

drop policy if exists "lead_interactions_select_own" on public.lead_interactions;
drop policy if exists lead_interactions_select_scoped on public.lead_interactions;

create policy lead_interactions_select_scoped on public.lead_interactions
  for select to authenticated using (
    user_id = auth.uid()
    or (mailbox_owner_id = auth.uid() and public.current_mailbox_owner_id() = auth.uid())
  );

comment on column public.lead_interactions.mailbox_owner_id is
  'Admin team the owning user belongs to — lets that admin see this interaction alongside their own; nullable, see 0048 migration note.';

-- BYOM, part 2: where each shared contact came from, and a metadata-only cache of the mail
-- shown in a contact's Mail tab.
--
-- 1. synced_contact_sources — the org still has ONE synced_contacts row per email (unique on
--    mailbox_owner_id + email since 0047, which is the dedupe). This table says which
--    mailboxes saw that address: one row per (mailbox, email), with that mailbox's own last
--    interaction and message count. Contacts are shared org-wide; this table only drives the
--    Contacts page filter (Common / BYOM) and records provenance.
--      Visibility: everyone in the org sees the rows of the common mailbox and their own; the
--      rows of other people's individual mailboxes are service-role only, so a direct read can
--      never reveal who else synced a contact. The API reduces those to a boolean.
--
-- 2. contact_mail_threads — thread-level header data (subject, sender, participants, date,
--    counts, flags) for mail exchanged with a contact, per mailbox. Same shape and policy as
--    gmail_thread_meta (0072): NO snippet, NO body. Every row is tagged with the mailbox it
--    came from (mailbox_id) and whose Gmail it is (owner_user_id).
--      Read rule — enforced here by RLS and again in the API; keep in sync with
--      lib/mailbox-context.ts:
--        - your own individual mailbox: yes;
--        - the org's common mailbox: if you have any access to it (admins always; staff with
--          no individual mailbox unless a permission row says 'none'; BYOM staff only when an
--          admin granted them a row);
--        - anyone else's individual mailbox: never, whatever role.
--      Writes are service role only.
--
-- 3. contact_mail_fetches — when a (mailbox, contact) was last fetched from Gmail, so "no
--    mail" can be told apart from "never looked", and a cache can be called stale.
--
-- Nothing here changes behaviour with the `byom` module off.
-- Undo with supabase/rollbacks/0095_byom_contact_sources_and_mail_cache.down.sql.

-- ---------------------------------------------------------------------------
-- Who may read a mailbox's mail. security definer: mailboxes and
-- user_mailbox_permissions have no policies for the signed-in role.
-- ---------------------------------------------------------------------------

create or replace function public.user_can_read_mailbox_mail(p_mailbox_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.mailboxes m
    join public.profiles p on p.id = auth.uid()
    where m.id = p_mailbox_id
      and (
        (m.mailbox_type = 'individual' and m.status = 'active' and m.owner_user_id = auth.uid())
        or (
          m.mailbox_type = 'common'
          and m.org_owner_id = case when p.role = 'admin' then p.id else p.mailbox_owner_id end
          and (
            p.role = 'admin'
            or coalesce(
              (select g.access_level
                 from public.user_mailbox_permissions g
                where g.user_id = auth.uid() and g.mailbox_id = m.id),
              case when exists (
                select 1 from public.mailboxes o
                where o.owner_user_id = auth.uid() and o.mailbox_type = 'individual' and o.status = 'active'
              ) then 'none' else 'full' end
            ) <> 'none'
          )
        )
      )
  )
$$;

grant execute on function public.user_can_read_mailbox_mail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- synced_contact_sources
-- ---------------------------------------------------------------------------

create table if not exists public.synced_contact_sources (
  mailbox_id           uuid not null references public.mailboxes (id) on delete cascade,
  email                text not null,
  -- The org whose contact book this feeds (synced_contacts.mailbox_owner_id).
  org_owner_id         uuid not null references auth.users (id) on delete cascade,
  -- Whose Gmail it is (the admin for the common mailbox).
  owner_user_id        uuid not null references auth.users (id) on delete cascade,
  last_interaction_at  timestamptz,
  message_count_total  int not null default 0,
  first_seen_at        timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (mailbox_id, email)
);

create index if not exists synced_contact_sources_org_email_idx
  on public.synced_contact_sources (org_owner_id, email);

comment on table public.synced_contact_sources is
  'Which mailboxes saw each shared contact (synced_contacts), with that mailbox''s own last interaction and count. Contact metadata only.';

alter table public.synced_contact_sources enable row level security;

drop policy if exists synced_contact_sources_select_visible on public.synced_contact_sources;
create policy synced_contact_sources_select_visible on public.synced_contact_sources
  for select to authenticated
  using (
    org_owner_id = public.current_mailbox_owner_id()
    and (
      owner_user_id = auth.uid()
      or exists (
        select 1 from public.mailboxes m
        where m.id = synced_contact_sources.mailbox_id and m.mailbox_type = 'common'
      )
    )
  );
-- No write policies: only the sync (service role) writes.

-- Every contact synced so far came from the common mailbox.
insert into public.synced_contact_sources
  (mailbox_id, email, org_owner_id, owner_user_id, last_interaction_at, message_count_total, first_seen_at)
select m.id, sc.email, sc.mailbox_owner_id, m.owner_user_id, sc.last_interaction_at,
       coalesce(sc.message_count_total, 0), coalesce(sc.created_at, now())
from public.synced_contacts sc
join public.mailboxes m on m.org_owner_id = sc.mailbox_owner_id and m.mailbox_type = 'common'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- contact_mail_threads
-- ---------------------------------------------------------------------------

create table if not exists public.contact_mail_threads (
  mailbox_id       uuid not null references public.mailboxes (id) on delete cascade,
  contact_email    text not null,
  thread_id        text not null,
  org_owner_id     uuid not null references auth.users (id) on delete cascade,
  owner_user_id    uuid not null references auth.users (id) on delete cascade,
  history_id       text,
  subject          text not null default '',
  from_header      text not null default '',
  participants     text[] not null default '{}',
  last_date        text not null default '',
  last_date_at     timestamptz,
  message_count    integer not null default 0,
  has_attachments  boolean not null default false,
  fetched_at       timestamptz not null default now(),
  primary key (mailbox_id, contact_email, thread_id)
);

create index if not exists contact_mail_threads_lookup_idx
  on public.contact_mail_threads (contact_email, last_date_at desc);
create index if not exists contact_mail_threads_fetched_at_idx
  on public.contact_mail_threads (fetched_at);

comment on table public.contact_mail_threads is
  'Per-mailbox thread headers for mail with a contact (no snippet, no body). RLS: own individual mailbox + common mailbox only. Purged after 90 days.';

alter table public.contact_mail_threads enable row level security;

drop policy if exists contact_mail_threads_select_readable on public.contact_mail_threads;
create policy contact_mail_threads_select_readable on public.contact_mail_threads
  for select to authenticated
  using (public.user_can_read_mailbox_mail(mailbox_id));
-- No write policies: only the API (service role) writes.

-- ---------------------------------------------------------------------------
-- contact_mail_fetches — service role only (RLS on, no policies).
-- ---------------------------------------------------------------------------

create table if not exists public.contact_mail_fetches (
  mailbox_id     uuid not null references public.mailboxes (id) on delete cascade,
  contact_email  text not null,
  fetched_at     timestamptz not null default now(),
  thread_count   integer not null default 0,
  primary key (mailbox_id, contact_email)
);

alter table public.contact_mail_fetches enable row level security;

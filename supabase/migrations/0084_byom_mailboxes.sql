-- Bring Your Own Mailbox (BYOM): staff may connect their own Gmail next to the
-- team's common mailbox, and switch between the two.
--
-- Nothing here changes how the app behaves today. The tenant ("org") is still
-- the admin's own auth user id — profiles.mailbox_owner_id on staff, and
-- current_mailbox_owner_id() in every RLS policy since 0047. These tables only
-- add a second thing that id used to mean on its own: *which Gmail account* a
-- request reads and sends with. For the common mailbox the two are the same id,
-- which is why no existing row needs rewriting.
--
-- Access rule (lib/mailbox-context.ts applies it; keep the two in sync):
--   - an admin always has full access to their own common mailbox;
--   - a staff member with NO individual mailbox has full access to the common
--     mailbox unless a user_mailbox_permissions row says otherwise — exactly
--     what every existing staff member has today, so nobody needs a backfill;
--   - a staff member WITH an individual mailbox (a BYOM sign-up) has no access
--     to the common mailbox until an admin grants it with a row here;
--   - an individual mailbox is only ever reachable by its owner. No
--     permission row can open it to anyone else.
--
-- Undo with supabase/rollbacks/0084_byom_mailboxes.down.sql.
-- Check with supabase/rollbacks/0084_byom_mailboxes.verify.sql.

-- ---------------------------------------------------------------------------
-- mailboxes: one row per Gmail account the workspace can work in.
-- ---------------------------------------------------------------------------

create table if not exists public.mailboxes (
  id             uuid primary key default gen_random_uuid(),
  -- The org this mailbox belongs to: the admin's auth user id.
  org_owner_id   uuid not null references auth.users (id) on delete cascade,
  mailbox_type   text not null check (mailbox_type in ('common', 'individual')),
  -- Whose google_mailbox_credentials row this mailbox uses. The admin for the
  -- common mailbox; the staff member themselves for an individual one.
  owner_user_id  uuid not null unique references auth.users (id) on delete cascade,
  gmail_address  text,
  status         text not null default 'active' check (status in ('active', 'disconnected')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint mailboxes_common_owned_by_org check (mailbox_type <> 'common' or owner_user_id = org_owner_id)
);

create unique index if not exists mailboxes_one_common_per_org
  on public.mailboxes (org_owner_id) where mailbox_type = 'common';
create index if not exists mailboxes_org_idx on public.mailboxes (org_owner_id);

comment on table public.mailboxes is
  'Gmail accounts an org works in: its common mailbox (the admin''s) and staff-connected individual ones. Service role only.';

-- One common mailbox for every admin that exists today.
insert into public.mailboxes (org_owner_id, mailbox_type, owner_user_id, gmail_address)
select p.id, 'common', p.id, c.gmail_address
from public.profiles p
left join public.google_mailbox_credentials c on c.owner_user_id = p.id
where p.role = 'admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- user_mailbox_permissions: what a staff member may do in a mailbox that
-- isn't their own. Only the common mailbox is grantable (enforced in the API).
-- ---------------------------------------------------------------------------

create table if not exists public.user_mailbox_permissions (
  user_id       uuid not null references auth.users (id) on delete cascade,
  mailbox_id    uuid not null references public.mailboxes (id) on delete cascade,
  access_level  text not null check (access_level in ('none', 'view', 'reply', 'full')),
  -- Gmail label ids the user is limited to; null = every label.
  label_scope   text[],
  granted_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, mailbox_id)
);

create index if not exists user_mailbox_permissions_mailbox_idx
  on public.user_mailbox_permissions (mailbox_id);

comment on table public.user_mailbox_permissions is
  'Admin-set access to the common mailbox per staff member. No row = the default in the 0084 header. Service role only.';

-- ---------------------------------------------------------------------------
-- org_signup_domains: which email domains may join an org by signing in with
-- Google. Without a matching row a new Google account still lands on
-- /no-access, as it does today.
-- ---------------------------------------------------------------------------

create table if not exists public.org_signup_domains (
  domain        text primary key check (domain = lower(domain) and domain !~ '@'),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  created_at    timestamptz not null default now()
);

create index if not exists org_signup_domains_org_idx on public.org_signup_domains (org_owner_id);

comment on table public.org_signup_domains is
  'Email domains that join an org (with their own mailbox) on first Google sign-in. Service role only.';

-- RLS on, no policies: every read and write goes through API routes with the
-- service role, like google_mailbox_credentials.
alter table public.mailboxes enable row level security;
alter table public.user_mailbox_permissions enable row level security;
alter table public.org_signup_domains enable row level security;

-- ---------------------------------------------------------------------------
-- Ship the module switched off on deployments that already saved a config
-- (0066's seed only applies to a fresh row). Idempotent.
-- ---------------------------------------------------------------------------

update public.platform_module_config
set config = jsonb_set(
  config,
  '{disabledModules}',
  coalesce(config->'disabledModules', '[]'::jsonb) || '["byom"]'::jsonb
)
where not coalesce(config->'disabledModules', '[]'::jsonb) ? 'byom';

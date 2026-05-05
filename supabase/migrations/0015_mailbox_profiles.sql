-- Profiles (admin vs staff) + long-lived Google mailbox tokens for shared inbox.
-- Run in Supabase SQL editor or via CLI after deploy.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'staff' check (role in ('admin', 'staff')),
  display_username text,
  mailbox_owner_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_mailbox_owner_id_idx
  on public.profiles (mailbox_owner_id);

comment on table public.profiles is 'app role; staff.mailbox_owner_id points at the Google-connected admin user';
comment on column public.profiles.mailbox_owner_id is 'Staff: auth user id of admin whose Gmail this user may access.';

create table if not exists public.google_mailbox_credentials (
  owner_user_id uuid primary key references auth.users (id) on delete cascade,
  gmail_address text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.google_mailbox_credentials is 'Server-only mailbox OAuth; read/write via service role in API routes only.';

alter table public.profiles enable row level security;
alter table public.google_mailbox_credentials enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- No policies on google_mailbox_credentials → deny for anon/authenticated; service role bypasses RLS.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, display_username)
  values (
    new.id,
    'staff',
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, role, display_username)
select
  u.id,
  'staff',
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- After migration: pick one Google-connected user as admin, then link staff users to that admin id.
-- Example:
--   update public.profiles set role = 'admin', mailbox_owner_id = null where id = '<admin-auth-user-uuid>';
--   update public.profiles set role = 'staff', mailbox_owner_id = '<admin-auth-user-uuid>' where id in ('<staff1>','<staff2>');

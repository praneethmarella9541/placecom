-- Custom team groups (admin-defined), profile fields, and OpenAI token limits.

create table if not exists public.team_groups (
  id                uuid primary key default gen_random_uuid(),
  mailbox_owner_id  uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  restricted_features text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (mailbox_owner_id, name)
);

comment on table public.team_groups is
  'Admin-defined access groups. restricted_features lists blocked workspace features for members in the group.';

create index if not exists team_groups_owner_idx on public.team_groups (mailbox_owner_id);

alter table public.profiles
  add column if not exists group_id uuid references public.team_groups (id) on delete set null,
  add column if not exists openai_token_limit bigint,
  add column if not exists job_title text,
  add column if not exists bio text;

comment on column public.profiles.openai_token_limit is
  'Max total OpenAI tokens (input + output) for email extraction; null = unlimited.';
comment on column public.profiles.group_id is
  'Optional admin-defined group; group restricted_features apply in addition to profile restrictions.';

alter table public.team_groups enable row level security;

create policy "team_groups_select_member" on public.team_groups
  for select using (
    mailbox_owner_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.group_id = team_groups.id
    )
  );

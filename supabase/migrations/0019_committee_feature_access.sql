-- Add committee role and per-user feature restrictions managed by admins.

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'staff', 'committee'));

alter table public.profiles
  add column if not exists restricted_features text[] not null default '{}';

comment on column public.profiles.restricted_features is
  'For committee members: blocked feature keys (inbox, drive, broadcasting, dashboard, crm, calendar, calls, meetings, sms, whatsapp).';

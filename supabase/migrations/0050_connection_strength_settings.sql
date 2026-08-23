-- Per-user tunable thresholds for the auto-synced-contacts "connection
-- strength" bucket (Good/Weak/Very weak/No communication). Deliberately
-- personal, not team-shared like synced_contacts itself — see the
-- lib/email-connection-strength.ts doc comment for the bucketing rule this
-- feeds. One row per user; absence of a row means "use the built-in
-- defaults" (DEFAULT_CONNECTION_STRENGTH_SETTINGS), so "reset to default" is
-- just deleting the row rather than a separate flag.
--
-- Good and Weak each get their own recency/volume/outbound-requirement
-- knobs, checked independently (highest tier first) rather than one shared
-- outbound gate for both — see bucketEmailConnection's doc comment.
-- treat_cc_only_as_no_communication needs synced_contacts.has_direct_contact
-- (migration 0051) to have anything to gate on.

create table if not exists public.user_connection_strength_settings (
  user_id                              uuid primary key references auth.users (id) on delete cascade,
  good_recency_days                    integer not null,
  good_min_messages_90d                integer not null,
  require_outbound_for_good            boolean not null,
  weak_recency_days                    integer not null,
  weak_min_messages_90d                integer not null,
  require_outbound_for_weak            boolean not null,
  treat_cc_only_as_no_communication    boolean not null default true,
  created_at                           timestamptz not null default now(),
  updated_at                           timestamptz not null default now(),
  constraint user_connection_strength_settings_days_check
    check (good_recency_days > 0 and weak_recency_days >= good_recency_days),
  constraint user_connection_strength_settings_count_check
    check (good_min_messages_90d > 0 and weak_min_messages_90d > 0)
);

comment on table public.user_connection_strength_settings is
  'Personal thresholds for bucketing synced_contacts by email engagement — one row per user, deleted to reset to defaults.';

alter table public.user_connection_strength_settings enable row level security;

drop policy if exists user_connection_strength_settings_select_own on public.user_connection_strength_settings;
drop policy if exists user_connection_strength_settings_upsert_own on public.user_connection_strength_settings;
drop policy if exists user_connection_strength_settings_update_own on public.user_connection_strength_settings;
drop policy if exists user_connection_strength_settings_delete_own on public.user_connection_strength_settings;

create policy user_connection_strength_settings_select_own on public.user_connection_strength_settings
  for select to authenticated using (user_id = auth.uid());

create policy user_connection_strength_settings_upsert_own on public.user_connection_strength_settings
  for insert to authenticated with check (user_id = auth.uid());

create policy user_connection_strength_settings_update_own on public.user_connection_strength_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy user_connection_strength_settings_delete_own on public.user_connection_strength_settings
  for delete to authenticated using (user_id = auth.uid());

-- Makes the "min messages" volume window itself configurable per bucket,
-- instead of hardcoded at 90 days for both Good and Weak — see
-- lib/email-connection-strength.ts and migration 0053 (which adds the raw
-- per-message dates this needs to compute an arbitrary window from; a
-- single rolling 90-day count, which is all synced_contacts stored before
-- that migration, can only ever answer "how many in the last 90 days").
--
-- Additive only — this table already has real rows, never drop/recreate it.

alter table public.user_connection_strength_settings
  add column if not exists good_window_days integer not null default 90,
  add column if not exists weak_window_days integer not null default 90;

alter table public.user_connection_strength_settings
  drop constraint if exists user_connection_strength_settings_window_check;
alter table public.user_connection_strength_settings
  add constraint user_connection_strength_settings_window_check
    check (good_window_days > 0 and weak_window_days > 0);

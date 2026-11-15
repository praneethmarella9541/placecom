-- Reverts 0083_profiles_column_privileges.sql: puts back table-wide UPDATE for both roles.
-- This restores the original (unsafe) state; only use it if the migration broke a feature.

grant update on table public.profiles to anon, authenticated;

-- Undo 0100. Every workspace reverts to the always-on legacy rules path (the only path that existed
-- before this migration), since the application treats a missing table the same as every flag off.
drop table if exists public.data_rules_feature_flags;

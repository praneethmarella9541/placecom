-- Undo 0102. Drops every duplicate-matching rule; no record is touched (detection only, never merge).
drop table if exists public.data_duplicate_rules;

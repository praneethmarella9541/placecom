-- Undo 0093. Drops every validation rule, all recorded stage history, favourites and highlights.
drop table if exists public.data_validation_rules;
drop table if exists public.data_list_entry_history;
drop table if exists public.data_favourites;
alter table public.data_objects drop column if exists highlights;

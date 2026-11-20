-- Undo 0090. Drops every note and task, and the stage targets. The Deals pipeline list created by
-- the new seed stays (it is an ordinary list); delete it from the app if you don't want it.
-- To restore the old seed function, re-run its definition from 0087.
drop table if exists public.data_tasks;
drop table if exists public.data_notes;
alter table public.data_list_stages drop column if exists target_days;

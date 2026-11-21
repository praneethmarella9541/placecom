-- Read-only checks for 0093. Run each block separately in the SQL editor.

-- 1. Empty after deploy. Expect 0, 0, 0.
select (select count(*) from public.data_validation_rules) as rules,
       (select count(*) from public.data_list_entry_history) as history,
       (select count(*) from public.data_favourites) as favourites;

-- 2. The signed-in role can't read them. Expect 0 rows from each.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  select count(*) from public.data_validation_rules;
  select count(*) from public.data_list_entry_history;
  select count(*) from public.data_favourites;
rollback;

-- 3. Highlights default to empty. Expect only 0.
select cardinality(highlights), count(*) from public.data_objects group by 1;

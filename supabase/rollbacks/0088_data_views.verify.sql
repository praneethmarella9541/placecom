-- Read-only checks for 0088. Run each block separately in the SQL editor.

-- 1. Empty after deploy. Expect 0.
select count(*) from public.data_views;

-- 2. The signed-in role can't read it (RLS, no policies). Expect 0 rows.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  select count(*) from public.data_views;
rollback;

-- 3. Views whose creator is gone and that aren't shared: nobody can see or edit them. Expect no rows.
select id, name from public.data_views where created_by is null and not is_shared;

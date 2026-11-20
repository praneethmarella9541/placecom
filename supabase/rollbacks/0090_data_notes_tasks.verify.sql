-- Read-only checks for 0090. Run each block separately in the SQL editor.

-- 1. Empty after deploy. Expect 0 and 0.
select (select count(*) from public.data_notes) as notes, (select count(*) from public.data_tasks) as tasks;

-- 2. The signed-in role can't read them. Expect 0 rows from each.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  select count(*) from public.data_notes;
  select count(*) from public.data_tasks;
rollback;

-- 3. After re-seeding an org (POST /api/data/setup {"action":"seed"}): the Deals pipeline has 6 stages.
select l.name, count(s.id) as stages
from public.data_lists l left join public.data_list_stages s on s.list_id = l.id
where l.slug = 'deals_pipeline' group by l.id, l.name;

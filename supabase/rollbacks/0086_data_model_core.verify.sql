-- Read-only checks for 0086/0087. Run each block separately in the SQL editor.

-- 1. The module ships off. Expect true.
select config->'disabledModules' ? 'dataModel' from public.platform_module_config;

-- 2. Nothing is in the data model until someone seeds or copies. Expect 0 from each.
select count(*) from public.data_objects;
select count(*) from public.data_records;

-- 3. The signed-in role can't read the tables (RLS, no policies). Expect 0 rows from each.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  select count(*) from public.data_records;
  select count(*) from public.data_attributes;
  select count(*) from public.data_list_entries;
rollback;

-- 4. The two functions can't be called by signed-in users. Expect "permission denied" for each.
begin;
  set local role authenticated;
  select public.data_model_backfill('00000000-0000-0000-0000-000000000000', true);
rollback;

-- 5. After a real copy for one org (replace the id). People with an email but no matching key.
--    Expect no rows.
select r.id, r.name
from public.data_records r
join public.data_objects o on o.id = r.object_id and o.slug = 'people'
where r.org_owner_id = '00000000-0000-0000-0000-000000000000'
  and jsonb_array_length(coalesce(r.values->'email_addresses', '[]'::jsonb)) > 0
  and not exists (select 1 from public.data_record_keys k where k.record_id = r.id and k.kind = 'email');

-- 6. Old tables unchanged by the copy: compare these counts before and after. Expect equal.
select
  (select count(*) from public.synced_contacts)    as synced_contacts,
  (select count(*) from public.directory_contacts) as directory_contacts,
  (select count(*) from public.leads)              as leads;

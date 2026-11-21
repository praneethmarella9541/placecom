-- Read-only checks for 0091. Run each block separately in the SQL editor. Replace ORG with the admin's user id.

-- 1. Counts before and after the leads copy must match for the old tables. Expect equal.
select (select count(*) from public.leads) as leads,
       (select count(*) from public.lead_interactions) as lead_interactions,
       (select count(*) from public.crm_stages) as crm_stages;

-- 2. Every lead the copy handled is on the list or counted as a duplicate. Leads still not copied:
select count(*) as leads_not_copied
from public.leads l
where (l.mailbox_owner_id = 'ORG' or (l.mailbox_owner_id is null and l.user_id in
        (select id from public.profiles where id = 'ORG' or mailbox_owner_id = 'ORG')))
  and not exists (select 1 from public.data_list_entries e where e.legacy_source = 'leads' and e.legacy_id = l.id);

-- 3. The Leads list's stages, in order.
select s.position, s.name, s.color from public.data_list_stages s
join public.data_lists l on l.id = s.list_id where l.slug = 'leads' and l.org_owner_id = 'ORG' order by s.position;

-- 4. Entries per stage. "null" = leads with no stage.
select s.name as stage, count(*) from public.data_list_entries e
join public.data_lists l on l.id = e.list_id and l.slug = 'leads' and l.org_owner_id = 'ORG'
left join public.data_list_stages s on s.id = e.stage_id group by s.name order by 2 desc;

-- 5. Notes copied. Expect lead_interactions rows <= interactions on copied leads.
select legacy_source, count(*) from public.data_notes where org_owner_id = 'ORG' group by 1;

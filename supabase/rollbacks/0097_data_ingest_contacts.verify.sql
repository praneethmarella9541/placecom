-- Read-only. Expect 0: synced contacts with no Person in Data (for an org with a People object).
select count(*) from public.synced_contacts s
where exists (select 1 from public.data_objects o where o.org_owner_id = s.mailbox_owner_id and o.slug = 'people')
  and not exists (
    select 1 from public.data_record_keys k
    where k.org_owner_id = s.mailbox_owner_id and k.kind = 'email' and k.value = lower(btrim(s.email)));

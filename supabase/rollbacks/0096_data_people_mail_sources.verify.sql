-- Read-only. Expect 0: a Person flagged common whose address no common mailbox source has.
select count(*) from public.data_records r
where r.has_common_source and not exists (
  select 1 from public.data_record_keys k
  join public.synced_contact_sources s on s.org_owner_id = k.org_owner_id and s.email = k.value
  join public.mailboxes m on m.id = s.mailbox_id and m.mailbox_type = 'common'
  where k.record_id = r.id and k.kind = 'email');

drop trigger if exists data_record_keys_flag_people on public.data_record_keys;
drop trigger if exists synced_contact_sources_flag_people on public.synced_contact_sources;
drop function if exists public.data_people_flag_from_key();
drop function if exists public.data_people_flag_from_source();
drop index if exists public.data_records_common_source_idx;
drop index if exists public.data_records_byom_source_idx;
alter table public.data_records drop column if exists has_common_source, drop column if exists has_byom_source;
drop index if exists public.synced_contact_sources_org_domain_idx;

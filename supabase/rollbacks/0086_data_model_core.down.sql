-- Undo 0086 and 0087 (flexible data model, version 1). Drops every record, list and history row
-- in the data model. The old tables (directory_contacts, synced_contacts, leads...) were never
-- changed, so nothing else needs restoring.

drop function if exists public.data_model_backfill(uuid, boolean);
drop function if exists public.data_model_seed(uuid);

drop table if exists public.data_record_history;
drop table if exists public.data_list_entries;
drop table if exists public.data_list_stages;
alter table if exists public.data_attributes drop constraint if exists data_attributes_list_fk;
drop table if exists public.data_lists;
drop table if exists public.data_record_keys;
drop table if exists public.data_records;
drop table if exists public.data_attributes;
drop table if exists public.data_objects;

update public.platform_module_config
set config = jsonb_set(config, '{disabledModules}', (config->'disabledModules') - 'dataModel')
where config->'disabledModules' ? 'dataModel';

-- Stops new contacts flowing into Data. People and Companies already created stay.
drop trigger if exists directory_contacts_ingest_data on public.directory_contacts;
drop trigger if exists synced_contacts_ingest_data on public.synced_contacts;
drop function if exists public.data_ingest_directory_trigger();
drop function if exists public.data_ingest_synced_trigger();
drop function if exists public.data_model_ingest_synced(uuid, uuid[]);

-- Deleting a shared directory contact used to leave any lead imported from it
-- behind on the CRM board (source_contact_id just went null — see 0054), so a
-- contact removed from the directory still showed up in someone's pipeline.
-- The directory is the source of truth a lead was created from; once that row
-- is gone there's nothing left for the lead to reflect, so it should go too —
-- across every user's board, since the directory is shared but leads aren't.
do $$
declare
  fk_name text;
begin
  select conname into fk_name
  from pg_constraint
  where conrelid = 'public.leads'::regclass
    and confrelid = 'public.directory_contacts'::regclass
    and contype = 'f';

  if fk_name is not null then
    execute format('alter table public.leads drop constraint %I', fk_name);
  end if;

  alter table public.leads
    add constraint leads_source_contact_id_fkey
    foreign key (source_contact_id) references public.directory_contacts (id) on delete cascade;
end $$;

-- BYOM in the Data tab: which kinds of mailbox saw each Person and each Company.
--
-- data_records.has_common_source / has_byom_source say whether the Person's email address (or, for
-- a Company, anyone at one of its domains) was seen in the org's common mailbox / in any individual
-- (BYOM) mailbox, so the People and Companies lists can filter
-- "Common mailbox" and "BYOM" in the database with paging, sorting and column filters intact.
-- They are org-level facts, the same for every viewer, and say nothing about WHOSE mailbox.
--
-- Kept current by two triggers: a sync recording a new source (synced_contact_sources, 0095), and
-- a Person gaining an email address (data_record_keys). Needs 0095 and 0086 applied.
-- Undo with supabase/rollbacks/0096_data_people_mail_sources.down.sql.

alter table public.data_records
  add column if not exists has_common_source boolean not null default false,
  add column if not exists has_byom_source   boolean not null default false;

create index if not exists data_records_common_source_idx
  on public.data_records (org_owner_id, object_id) where has_common_source;
create index if not exists data_records_byom_source_idx
  on public.data_records (org_owner_id, object_id) where has_byom_source;

create or replace function public.data_people_flag_from_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  select mailbox_type into v_type from public.mailboxes where id = new.mailbox_id;
  if v_type is null then return new; end if;
  update public.data_records r
     set has_common_source = r.has_common_source or v_type = 'common',
         has_byom_source   = r.has_byom_source or v_type = 'individual'
    from public.data_record_keys k
   where k.org_owner_id = new.org_owner_id
     and k.kind = 'email'
     and k.value = lower(btrim(new.email))
     and r.id = k.record_id
     and r.org_owner_id = k.org_owner_id
     and ((v_type = 'common' and not r.has_common_source) or (v_type = 'individual' and not r.has_byom_source));

  -- The Company owning the address's domain.
  update public.data_records r
     set has_common_source = r.has_common_source or v_type = 'common',
         has_byom_source   = r.has_byom_source or v_type = 'individual'
    from public.data_record_keys k
   where k.org_owner_id = new.org_owner_id
     and k.kind = 'domain'
     and k.value = split_part(lower(btrim(new.email)), '@', 2)
     and r.id = k.record_id
     and r.org_owner_id = k.org_owner_id
     and ((v_type = 'common' and not r.has_common_source) or (v_type = 'individual' and not r.has_byom_source));
  return new;
end;
$$;

drop trigger if exists synced_contact_sources_flag_people on public.synced_contact_sources;
create trigger synced_contact_sources_flag_people
  after insert on public.synced_contact_sources
  for each row execute function public.data_people_flag_from_source();

create or replace function public.data_people_flag_from_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.data_records r
     set has_common_source = x.c, has_byom_source = x.b
    from (
      select coalesce(bool_or(m.mailbox_type = 'common'), false) as c,
             coalesce(bool_or(m.mailbox_type = 'individual'), false) as b
        from public.synced_contact_sources s
        join public.mailboxes m on m.id = s.mailbox_id
       where s.org_owner_id = new.org_owner_id
         and ((new.kind = 'email' and s.email = new.value)
           or (new.kind = 'domain' and split_part(s.email, '@', 2) = new.value))
    ) x
   where r.id = new.record_id and r.org_owner_id = new.org_owner_id
     and (r.has_common_source <> x.c or r.has_byom_source <> x.b);
  return new;
end;
$$;

drop trigger if exists data_record_keys_flag_people on public.data_record_keys;
create trigger data_record_keys_flag_people
  after insert on public.data_record_keys
  for each row execute function public.data_people_flag_from_key();

-- Existing People and Companies.
update public.data_records r
   set has_common_source = x.c, has_byom_source = x.b
  from (
    select k.record_id, k.org_owner_id,
           bool_or(m.mailbox_type = 'common') as c,
           bool_or(m.mailbox_type = 'individual') as b
      from public.data_record_keys k
      join public.synced_contact_sources s
        on s.org_owner_id = k.org_owner_id
       and ((k.kind = 'email' and s.email = k.value)
         or (k.kind = 'domain' and split_part(s.email, '@', 2) = k.value))
      join public.mailboxes m on m.id = s.mailbox_id
     group by k.record_id, k.org_owner_id
  ) x
 where r.id = x.record_id and r.org_owner_id = x.org_owner_id;

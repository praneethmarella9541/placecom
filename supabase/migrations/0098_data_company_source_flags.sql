-- BYOM source flags for Companies in the Data tab.
--
-- 0096 first shipped flagging People only; Companies were added to it afterwards, which a database
-- that had already applied 0096 never picked up — so every Company read "no source" and the
-- "Common mailbox" / "BYOM" filter on the Companies list was always empty. This re-states the two
-- trigger functions with Company handling (a Company is flagged when anyone at one of its domains
-- was seen in that kind of mailbox) and backfills the flags. Safe to run on a database that has
-- either version of 0096, and to run twice. Needs 0095 and 0096.
-- Undo: the 0096 down script drops the same objects.

-- Lets a Company's domain find its contacts' source rows without scanning the org's whole set.
create index if not exists synced_contact_sources_org_domain_idx
  on public.synced_contact_sources (org_owner_id, (split_part(email, '@', 2)));

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

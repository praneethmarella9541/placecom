-- Keep the Data tab's People and Companies in step with the Contacts book.
--
-- 0087 copied synced_contacts and directory_contacts into data_records ONCE (an admin ran the
-- backfill). Anything synced afterwards — including every contact a BYOM mailbox finds — never
-- reached the Data tab, so its People and Companies fell behind the Contacts page.
--
-- data_model_ingest_synced(org, ids) is steps 1, 3 and 4 of that backfill, safe to re-run: a person
-- for each synced address that has none, a company for each new business domain, and the link
-- between them. A trigger runs it for every batch of newly synced contacts; a second trigger copies
-- a newly added directory card. Both do nothing for an org whose Data model hasn't been set up
-- (no People object), and neither can fail the statement that fired it.
--
-- Not carried over: edits and deletes. A renamed or removed contact is left as it is in Data.
-- Free webmail domains (gmail.com …) get no Company, as in the backfill.
-- Needs 0086/0087 (and 0096 for the source flags). Undo with
-- supabase/rollbacks/0097_data_ingest_contacts.down.sql.

create or replace function public.data_model_ingest_synced(p_org uuid, p_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_people    uuid;
  v_companies uuid;
  v_free      text[] := array[
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com',
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com',
    'proton.me', 'protonmail.com', 'rediffmail.com', 'zoho.com', 'mail.com', 'gmx.com'
  ];
  n integer;
begin
  select id into v_people    from public.data_objects where org_owner_id = p_org and slug = 'people';
  select id into v_companies from public.data_objects where org_owner_id = p_org and slug = 'companies';
  if v_people is null then return; end if;

  -- Two syncs finishing together must not each create the same company.
  perform pg_advisory_xact_lock(hashtext('data_ingest:' || p_org::text));

  -- 1. People: one per lower-cased address that has none yet.
  with src as (
    select distinct on (lower(btrim(s.email)))
      s.id, lower(btrim(s.email)) as email, s.display_name
    from public.synced_contacts s
    where s.mailbox_owner_id = p_org and s.email is not null and btrim(s.email) <> ''
      and (p_ids is null or s.id = any(p_ids))
    order by lower(btrim(s.email)), s.updated_at desc
  ), ins as (
    insert into public.data_records (org_owner_id, object_id, name, values, legacy_source, legacy_id)
    select p_org, v_people,
           coalesce(nullif(btrim(src.display_name), ''), split_part(src.email, '@', 1)),
           jsonb_build_object('email_addresses', jsonb_build_array(src.email)),
           'synced_contacts', src.id
    from src
    where not exists (
      select 1 from public.data_record_keys k
      where k.org_owner_id = p_org and k.object_id = v_people and k.kind = 'email' and k.value = src.email
    )
    on conflict (org_owner_id, legacy_source, legacy_id) where legacy_source is not null do nothing
    returning id, legacy_id
  ), keys as (
    insert into public.data_record_keys (org_owner_id, object_id, record_id, kind, value)
    select p_org, v_people, ins.id, 'email', src.email
    from ins join src on src.id = ins.legacy_id
    on conflict do nothing
    returning 1
  )
  select count(*) into n from keys;

  if v_companies is null then return; end if;

  -- 3. Companies: one per business domain among these contacts that has none yet.
  with doms as (
    select distinct lower(split_part(btrim(s.email), '@', 2)) as domain
    from public.synced_contacts s
    where s.mailbox_owner_id = p_org and s.email like '%@%'
      and (p_ids is null or s.id = any(p_ids))
  ), named as (
    select d.domain,
      coalesce(
        (select s.company_name from public.synced_contacts s
          where s.mailbox_owner_id = p_org and lower(s.domain) = d.domain
            and s.company_name is not null and btrim(s.company_name) <> ''
            and lower(btrim(s.company_name)) <> d.domain
          group by s.company_name order by count(*) desc, s.company_name limit 1),
        d.domain) as name
    from doms d
    where d.domain <> '' and d.domain <> all (v_free)
      and not exists (
        select 1 from public.data_record_keys ck
        where ck.org_owner_id = p_org and ck.object_id = v_companies and ck.kind = 'domain' and ck.value = d.domain
      )
  ), ins as (
    insert into public.data_records (org_owner_id, object_id, name, values)
    select p_org, v_companies, named.name, jsonb_build_object('domains', jsonb_build_array(named.domain))
    from named
    returning id, values->'domains'->>0 as domain
  ), keys as (
    insert into public.data_record_keys (org_owner_id, object_id, record_id, kind, value)
    select p_org, v_companies, ins.id, 'domain', ins.domain from ins
    on conflict do nothing
    returning 1
  )
  select count(*) into n from keys;

  -- 4. Link each of these people to the company owning their domain (only where unset).
  with link as (
    select k.record_id as person_id, ck.record_id as company_id
    from public.synced_contacts s
    join public.data_record_keys k
      on k.org_owner_id = p_org and k.object_id = v_people and k.kind = 'email' and k.value = lower(btrim(s.email))
    join public.data_record_keys ck
      on ck.org_owner_id = p_org and ck.object_id = v_companies and ck.kind = 'domain'
     and ck.value = split_part(k.value, '@', 2)
    where s.mailbox_owner_id = p_org and (p_ids is null or s.id = any(p_ids))
  ), upd as (
    update public.data_records r
       set values = r.values || jsonb_build_object('company', l.company_id::text)
      from (select distinct on (person_id) person_id, company_id from link order by person_id, company_id) l
     where r.id = l.person_id and r.org_owner_id = p_org and not (r.values ? 'company')
    returning 1
  )
  select count(*) into n from upd;
end;
$$;

-- Newly synced contacts (statement level: one call per batch, not per row).
create or replace function public.data_ingest_synced_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
begin
  for o in select mailbox_owner_id as org, array_agg(id) as ids from newrows group by mailbox_owner_id loop
    begin
      perform public.data_model_ingest_synced(o.org, o.ids);
    exception when others then
      -- Never fail a contact sync because the Data tab couldn't be updated.
      raise warning 'data_model_ingest_synced failed for %: %', o.org, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

drop trigger if exists synced_contacts_ingest_data on public.synced_contacts;
create trigger synced_contacts_ingest_data
  after insert on public.synced_contacts
  referencing new table as newrows
  for each statement execute function public.data_ingest_synced_trigger();

-- A directory card added by hand: merged onto the person with the same email, else a new person
-- (step 2 of the backfill, for one row).
create or replace function public.data_ingest_directory_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_people uuid;
  v_email  text := nullif(lower(btrim(coalesce(new.email, ''))), '');
  v_person uuid;
  v_vals   jsonb;
begin
  select id into v_people from public.data_objects where org_owner_id = new.mailbox_owner_id and slug = 'people';
  if v_people is null then return new; end if;
  if coalesce(btrim(new.name), '') = '' and v_email is null then return new; end if;
  begin
    perform pg_advisory_xact_lock(hashtext('data_ingest:' || new.mailbox_owner_id::text));
    v_vals := jsonb_strip_nulls(jsonb_build_object(
      'phone_numbers', case when nullif(btrim(coalesce(new.phone, '')), '') is null then null
                            else jsonb_build_array(btrim(new.phone)) end,
      'job_title',     nullif(btrim(coalesce(new.title, '')), ''),
      'linkedin',      nullif(btrim(coalesce(new.linkedin_url, '')), ''),
      'description',   nullif(btrim(coalesce(new.notes, '')), '')
    ));
    if v_email is not null then
      select k.record_id into v_person from public.data_record_keys k
       where k.org_owner_id = new.mailbox_owner_id and k.object_id = v_people and k.kind = 'email' and k.value = v_email;
    end if;
    if v_person is not null then
      update public.data_records
         set values = v_vals || values,
             name = case when name = '' or name = split_part(v_email, '@', 1)
                         then coalesce(nullif(btrim(new.name), ''), name) else name end,
             updated_at = now()
       where id = v_person and org_owner_id = new.mailbox_owner_id;
    else
      insert into public.data_records (org_owner_id, object_id, name, values, legacy_source, legacy_id)
      values (
        new.mailbox_owner_id, v_people,
        coalesce(nullif(btrim(new.name), ''), split_part(v_email, '@', 1)),
        v_vals || case when v_email is null then '{}'::jsonb
                       else jsonb_build_object('email_addresses', jsonb_build_array(v_email)) end,
        'directory_contacts', new.id
      )
      on conflict (org_owner_id, legacy_source, legacy_id) where legacy_source is not null do nothing
      returning id into v_person;
      if v_person is not null and v_email is not null then
        insert into public.data_record_keys (org_owner_id, object_id, record_id, kind, value)
        values (new.mailbox_owner_id, v_people, v_person, 'email', v_email)
        on conflict do nothing;
      end if;
    end if;
  exception when others then
    raise warning 'data_ingest_directory_trigger failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists directory_contacts_ingest_data on public.directory_contacts;
create trigger directory_contacts_ingest_data
  after insert on public.directory_contacts
  for each row execute function public.data_ingest_directory_trigger();

-- Catch up: contacts synced since the backfill that never reached Data.
do $$
declare
  o record;
begin
  for o in select distinct org_owner_id from public.data_objects where slug = 'people' loop
    begin
      perform public.data_model_ingest_synced(o.org_owner_id, null);
    exception when others then
      raise warning 'catch-up failed for %: %', o.org_owner_id, sqlerrm;
    end;
  end loop;
end;
$$;

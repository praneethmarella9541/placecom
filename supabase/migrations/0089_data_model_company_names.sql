-- Flexible data model: nicer company names in the copy from the old contacts.
--
-- 0087 named a company after the most common synced company name for its domain, and fell back to
-- the raw domain ("xlri.ac.in"). Those synced names come from a fuzzy lookup (logo.dev) and a
-- guess, so the same company could read "FLS" in one place and "Flsmidth" in another. This puts
-- what a person typed on a team-directory card first, then the synced name, then a tidy version of
-- the domain. It changes how NEW companies are named when the copy runs; companies already created
-- keep their names (rename them on the record page).
--
-- Replaces the 0087 function. Undo by re-running 0087's data_model_backfill definition.

create or replace function public.data_model_company_label(p_domain text)
returns text
language sql
immutable
as $$
  select initcap(replace(replace(split_part(regexp_replace(lower(btrim(p_domain)), '^(www|mail|smtp|email|e)\.', ''), '.', 1), '-', ' '), '_', ' '))
$$;

create or replace function public.data_model_backfill(p_org uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_people    uuid;
  v_companies uuid;
  n_synced        integer := 0;
  n_dir_new       integer := 0;
  n_dir_merged    integer := 0;
  n_companies     integer := 0;
  n_linked        integer := 0;
  n_dir_skipped   integer := 0;
  v_free_domains  text[] := array[
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com',
    'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'aol.com',
    'proton.me', 'protonmail.com', 'rediffmail.com', 'zoho.com', 'mail.com', 'gmx.com'
  ];
begin
  -- Everything between here and the final raise is rolled back on a dry run. plpgsql variables are
  -- not transactional, so the counters survive the rollback and are what gets returned.
  begin
    perform public.data_model_seed(p_org);
    select id into v_people    from public.data_objects where org_owner_id = p_org and slug = 'people';
    select id into v_companies from public.data_objects where org_owner_id = p_org and slug = 'companies';

    -- 1. synced_contacts -> People. One row per lower-cased email (the old unique key is case
    --    sensitive, so two rows can differ only in case).
    with src as (
      select distinct on (lower(btrim(s.email)))
        s.id, lower(btrim(s.email)) as email, s.display_name
      from public.synced_contacts s
      where s.mailbox_owner_id = p_org and s.email is not null and btrim(s.email) <> ''
      order by lower(btrim(s.email)), s.updated_at desc
    ), ins as (
      insert into public.data_records
        (org_owner_id, object_id, name, values, legacy_source, legacy_id)
      select p_org, v_people,
             coalesce(nullif(btrim(src.display_name), ''), split_part(src.email, '@', 1)),
             jsonb_build_object('email_addresses', jsonb_build_array(src.email)),
             'synced_contacts', src.id
      from src
      -- A person added by an earlier run (same legacy id) or already holding this email is skipped.
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
    select count(*) into n_synced from ins;

    -- 2. directory_contacts -> People. Same email as an existing person: fill the person's empty
    --    fields from the card. Otherwise a new person (cards without an email always add one).
    declare
      r record;
      v_email text;
      v_person uuid;
      v_vals jsonb;
    begin
      for r in
        select d.*
        from public.directory_contacts d
        where d.mailbox_owner_id = p_org
          and not exists (
            select 1 from public.data_records x
            where x.org_owner_id = p_org and x.legacy_source = 'directory_contacts' and x.legacy_id = d.id
          )
        order by d.created_at
      loop
        v_email := nullif(lower(btrim(coalesce(r.email, ''))), '');
        if coalesce(btrim(r.name), '') = '' and v_email is null then
          n_dir_skipped := n_dir_skipped + 1;
          continue;
        end if;

        v_vals := jsonb_strip_nulls(jsonb_build_object(
          'phone_numbers', case when nullif(btrim(coalesce(r.phone, '')), '') is null then null
                                else jsonb_build_array(btrim(r.phone)) end,
          'job_title',     nullif(btrim(coalesce(r.title, '')), ''),
          'linkedin',      nullif(btrim(coalesce(r.linkedin_url, '')), ''),
          'description',   nullif(btrim(coalesce(r.notes, '')), '')
        ));

        v_person := null;
        if v_email is not null then
          select k.record_id into v_person
          from public.data_record_keys k
          where k.org_owner_id = p_org and k.object_id = v_people and k.kind = 'email' and k.value = v_email;
        end if;

        if v_person is not null then
          -- Existing values win; the card only fills gaps.
          update public.data_records
          set values = v_vals || values,
              name = case when name = '' or name = split_part(v_email, '@', 1)
                          then coalesce(nullif(btrim(r.name), ''), name) else name end,
              updated_at = now()
          where id = v_person and org_owner_id = p_org;
          n_dir_merged := n_dir_merged + 1;
        else
          insert into public.data_records
            (org_owner_id, object_id, name, values, legacy_source, legacy_id)
          values (
            p_org, v_people,
            coalesce(nullif(btrim(r.name), ''), split_part(v_email, '@', 1)),
            v_vals || case when v_email is null then '{}'::jsonb
                           else jsonb_build_object('email_addresses', jsonb_build_array(v_email)) end,
            'directory_contacts', r.id
          )
          returning id into v_person;
          if v_email is not null then
            insert into public.data_record_keys (org_owner_id, object_id, record_id, kind, value)
            values (p_org, v_people, v_person, 'email', v_email)
            on conflict do nothing;
          end if;
          n_dir_new := n_dir_new + 1;
        end if;
      end loop;
    end;

    -- 3. Companies, one per business domain found on a person's email. The name comes from the
    --    most common company_name synced for that domain, else the domain itself.
    with doms as (
      select split_part(k.value, '@', 2) as domain, count(*) as people
      from public.data_record_keys k
      where k.org_owner_id = p_org and k.object_id = v_people and k.kind = 'email'
        and position('@' in k.value) > 0
        and split_part(k.value, '@', 2) <> ''
        and split_part(k.value, '@', 2) <> all (v_free_domains)
      group by 1
    ), named as (
      -- Name a company from the most trustworthy source that has one:
      --   1. what a person typed on a team-directory card for someone at that domain;
      --   2. the name looked up when the mailbox was synced (logo.dev, else a guess);
      --   3. the domain's own name, tidied: xlri.ac.in -> Xlri.
      select d.domain,
        coalesce(
          (select btrim(regexp_replace(x.company, '\s+', ' ', 'g'))
           from public.directory_contacts x
           where x.mailbox_owner_id = p_org
             and lower(split_part(btrim(coalesce(x.email, '')), '@', 2)) = d.domain
             and btrim(coalesce(x.company, '')) <> ''
           group by 1 order by count(*) desc, 1 limit 1),
          (select btrim(regexp_replace(s.company_name, '\s+', ' ', 'g'))
           from public.synced_contacts s
           where s.mailbox_owner_id = p_org and lower(s.domain) = d.domain
             and btrim(coalesce(s.company_name, '')) <> ''
             and lower(btrim(s.company_name)) <> d.domain
           group by 1 order by count(*) desc, 1 limit 1),
          public.data_model_company_label(d.domain)) as name
      from doms d
      where not exists (
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
    select count(*) into n_companies from ins;

    -- 4. Link each person to the company that owns their email's domain (only where unset).
    with link as (
      select k.record_id as person_id, ck.record_id as company_id
      from public.data_record_keys k
      join public.data_record_keys ck
        on ck.org_owner_id = k.org_owner_id and ck.object_id = v_companies and ck.kind = 'domain'
       and ck.value = split_part(k.value, '@', 2)
      where k.org_owner_id = p_org and k.object_id = v_people and k.kind = 'email'
    ), upd as (
      update public.data_records r
      set values = r.values || jsonb_build_object('company', l.company_id::text)
      from (select distinct on (person_id) person_id, company_id from link order by person_id, company_id) l
      where r.id = l.person_id and r.org_owner_id = p_org and not (r.values ? 'company')
      returning 1
    )
    select count(*) into n_linked from upd;

    if p_dry_run then
      raise exception 'data_model_dry_run' using errcode = 'P0001';
    end if;
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'data_model_dry_run' then
      raise;
    end if;
  end;

  return jsonb_build_object(
    'dry_run', p_dry_run,
    'people_from_synced_contacts', n_synced,
    'people_from_directory_contacts', n_dir_new,
    'directory_cards_merged_into_existing_people', n_dir_merged,
    'directory_cards_skipped_no_name_or_email', n_dir_skipped,
    'companies_created', n_companies,
    'people_linked_to_company', n_linked
  );
end;
$$;

revoke all on function public.data_model_company_label(text) from public, anon, authenticated;
revoke all on function public.data_model_backfill(uuid, boolean) from public, anon, authenticated;
grant execute on function public.data_model_company_label(text) to service_role;
grant execute on function public.data_model_backfill(uuid, boolean) to service_role;

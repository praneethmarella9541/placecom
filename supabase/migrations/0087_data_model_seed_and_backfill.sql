-- Flexible data model, version 1: two functions. This migration only DEFINES them; nothing runs
-- until an admin calls them (POST /api/data/setup, or by hand in the SQL editor).
--
--   data_model_seed(org)                 creates People, Companies and Deals and their system
--                                        attributes for one org. Idempotent.
--   data_model_backfill(org, dry_run)    copies the org's existing contacts in as records and returns
--                                        counts. dry_run => true (the default) does the whole copy
--                                        and then rolls it back, so the counts are exactly what a real
--                                        run would do and nothing is written.
--
-- The copy NEVER changes or deletes the old tables. Each copied row remembers where it came from
-- (legacy_source, legacy_id), so running it again adds only what is new.
--
-- What is copied in version 1:
--   synced_contacts   -> People  (email, name)
--   directory_contacts -> People (merged onto the person with the same email, else a new person)
--   company domains   -> Companies (one per non-free-mail domain), people linked to them
-- Not copied yet: leads, crm_stages, lead_interactions (the pipeline). Those are per-user boards
-- today (0055), so turning them into one shared list needs a decision first.
--
-- Undo with supabase/rollbacks/0086_data_model_core.down.sql (drops the tables and these functions).

-- ---------------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------------

create or replace function public.data_model_seed(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.data_objects (org_owner_id, slug, singular_name, plural_name, is_system, position)
  values
    (p_org, 'people',    'Person',  'People',    true, 0),
    (p_org, 'companies', 'Company', 'Companies', true, 1),
    (p_org, 'deals',     'Deal',    'Deals',     true, 2)
  on conflict (org_owner_id, slug) do nothing;

  -- `name` is not listed: it is the record's core column, not a value.
  insert into public.data_attributes
    (org_owner_id, object_id, slug, name, type, is_multi, config, is_system, is_unique, position)
  select p_org, o.id, a.slug, a.name, a.type, a.is_multi, a.config, true, a.is_unique, a.pos
  from public.data_objects o
  join (values
    ('people',    'email_addresses', 'Email addresses', 'email',      true,  '{}'::jsonb,                          true,  1),
    ('people',    'phone_numbers',   'Phone numbers',   'phone',      true,  '{}'::jsonb,                          false, 2),
    ('people',    'job_title',       'Job title',       'text',       false, '{}'::jsonb,                          false, 3),
    ('people',    'company',         'Company',         'record_ref', false, '{"target_object":"companies"}'::jsonb, false, 4),
    ('people',    'linkedin',        'LinkedIn',        'url',        false, '{}'::jsonb,                          false, 5),
    ('people',    'description',     'Description',     'long_text',  false, '{}'::jsonb,                          false, 6),
    ('companies', 'domains',         'Domains',         'domain',     true,  '{}'::jsonb,                          true,  1),
    ('companies', 'linkedin',        'LinkedIn',        'url',        false, '{}'::jsonb,                          false, 2),
    ('companies', 'description',     'Description',     'long_text',  false, '{}'::jsonb,                          false, 3),
    ('deals',     'value',           'Value',           'currency',   false, '{"currency":"INR"}'::jsonb,          false, 1),
    ('deals',     'company',         'Company',         'record_ref', false, '{"target_object":"companies"}'::jsonb, false, 2),
    ('deals',     'person',          'Person',          'record_ref', false, '{"target_object":"people"}'::jsonb,    false, 3),
    ('deals',     'owner',           'Owner',           'member',     false, '{}'::jsonb,                          false, 4),
    ('deals',     'expected_close',  'Expected close',  'date',       false, '{}'::jsonb,                          false, 5)
  ) as a(object_slug, slug, name, type, is_multi, config, is_unique, pos) on a.object_slug = o.slug
  where o.org_owner_id = p_org
  on conflict (object_id, slug) where list_id is null do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------

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
      select d.domain,
        coalesce(
          (select s.company_name from public.synced_contacts s
           where s.mailbox_owner_id = p_org and lower(s.domain) = d.domain
             and s.company_name is not null and btrim(s.company_name) <> ''
             and lower(btrim(s.company_name)) <> d.domain
           group by s.company_name order by count(*) desc, s.company_name limit 1),
          d.domain) as name
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

-- Callable by the service role only: both functions take any org id, so they must never be
-- reachable from a signed-in browser session.
revoke all on function public.data_model_seed(uuid) from public, anon, authenticated;
revoke all on function public.data_model_backfill(uuid, boolean) from public, anon, authenticated;
grant execute on function public.data_model_seed(uuid) to service_role;
grant execute on function public.data_model_backfill(uuid, boolean) to service_role;

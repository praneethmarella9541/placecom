-- Flexible data model: copy the CRM pipeline into a "Leads" list on People.
--
--   data_model_backfill_leads(org, dry_run)   dry_run => true (the default) does the whole copy and
--                                             rolls it back, so the counts are what a real run does.
--
-- What it does, per the data model brief:
--   * Every lead becomes an ENTRY on a Leads list (a list on People). The person is the one with the
--     same email if there is one, else a new person; their company is matched by name or created.
--   * The per-user CRM boards (crm_stages) become ONE shared set of stages on the list, merged by
--     name (case-insensitive), ordered by where they sat on the boards.
--   * Score (Hot/Warm/Cold) and the staff name become fields on the entry.
--   * lead_interactions and the contact book's notes (crm_contact_notes) become notes on the person.
--
-- It never changes or deletes leads, crm_stages, lead_interactions or crm_contact_notes. Each copied
-- row remembers its source (legacy_source, legacy_id), so running it again adds only what is new.
-- If two leads (from different people on the team) are the same person, the first becomes the entry
-- and the other is counted as a duplicate; its interactions still come across as notes.
--
-- Same access as 0087: service role only. Undo with supabase/rollbacks/0091_data_model_leads_copy.down.sql.

create or replace function public.data_model_backfill_leads(p_org uuid, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team      uuid[];
  v_people    uuid;
  v_companies uuid;
  v_list      uuid;
  r           record;
  v_email     text;
  v_phone     text;
  v_person    uuid;
  v_company   uuid;
  v_cname     text;
  v_stage     uuid;
  v_entry     uuid;
  v_vals      jsonb;
  v_n         integer;
  n_stages        integer := 0;
  n_entries       integer := 0;
  n_duplicates    integer := 0;
  n_new_people    integer := 0;
  n_matched       integer := 0;
  n_new_companies integer := 0;
  n_notes         integer := 0;
  n_contact_notes integer := 0;
begin
  select coalesce(array_agg(p.id), '{}') into v_team
  from public.profiles p where p.id = p_org or p.mailbox_owner_id = p_org;

  begin
    perform public.data_model_seed(p_org);
    select id into v_people    from public.data_objects where org_owner_id = p_org and slug = 'people';
    select id into v_companies from public.data_objects where org_owner_id = p_org and slug = 'companies';

    -- The list, its two entry fields, and the shared stages.
    insert into public.data_lists (org_owner_id, object_id, slug, name, has_stages)
    values (p_org, v_people, 'leads', 'Leads', true)
    on conflict (org_owner_id, slug) do nothing;
    select id into v_list from public.data_lists where org_owner_id = p_org and slug = 'leads';

    insert into public.data_attributes (org_owner_id, object_id, list_id, slug, name, type, config, position)
    values
      (p_org, v_people, v_list, 'score', 'Score', 'select', '{"options":["Hot","Warm","Cold"]}'::jsonb, 1),
      (p_org, v_people, v_list, 'staff', 'Staff', 'text', '{}'::jsonb, 2)
    on conflict (list_id, slug) where list_id is not null do nothing;

    with src as (
      select lower(btrim(s.name)) as k, s.name, s.color, s.position, s.created_at
      from public.crm_stages s
      where s.user_id = any (v_team) or s.mailbox_owner_id = p_org
    ), merged as (
      select k,
             (array_agg(name  order by position, created_at))[1] as name,
             (array_agg(color order by position, created_at))[1] as color,
             min(position) as pos
      from src group by k
    ), ins as (
      insert into public.data_list_stages (org_owner_id, list_id, name, color, position)
      select p_org, v_list, m.name, m.color, (row_number() over (order by m.pos, m.name))::integer
      from merged m
      where not exists (
        select 1 from public.data_list_stages x where x.list_id = v_list and lower(btrim(x.name)) = m.k
      )
      on conflict (list_id, name) do nothing
      returning 1
    )
    select count(*) into n_stages from ins;

    -- Leads -> entries.
    for r in
      select l.*, cs.name as stage_name
      from public.leads l
      left join public.crm_stages cs on cs.id = l.stage_id
      where (l.mailbox_owner_id = p_org or (l.mailbox_owner_id is null and l.user_id = any (v_team)))
        and not exists (
          select 1 from public.data_list_entries e
          where e.org_owner_id = p_org and e.legacy_source = 'leads' and e.legacy_id = l.id
        )
      order by l.created_at
    loop
      v_email := nullif(lower(btrim(coalesce(r.email, ''))), '');
      v_phone := regexp_replace(coalesce(r.phone, ''), '[\s().-]', '', 'g');
      if v_phone !~ '^\+?\d{6,15}$' then v_phone := null; end if;

      v_person := null;
      if v_email is not null then
        select k.record_id into v_person from public.data_record_keys k
        where k.org_owner_id = p_org and k.object_id = v_people and k.kind = 'email' and k.value = v_email;
      end if;
      if v_person is null then
        select x.id into v_person from public.data_records x
        where x.org_owner_id = p_org and x.object_id = v_people and x.legacy_source = 'leads' and x.legacy_id = r.id
          and x.deleted_at is null;
      end if;

      if v_person is null then
        v_vals := jsonb_strip_nulls(jsonb_build_object(
          'email_addresses', case when v_email is null then null else jsonb_build_array(v_email) end,
          'phone_numbers',   case when v_phone is null then null else jsonb_build_array(v_phone) end
        ));
        insert into public.data_records (org_owner_id, object_id, name, values, legacy_source, legacy_id, created_at)
        values (
          p_org, v_people,
          coalesce(nullif(btrim(r.contact_name), ''), nullif(btrim(r.company_name), ''), v_email, 'Unnamed lead'),
          v_vals, 'leads', r.id, r.created_at
        )
        returning id into v_person;
        if v_email is not null then
          insert into public.data_record_keys (org_owner_id, object_id, record_id, kind, value)
          values (p_org, v_people, v_person, 'email', v_email) on conflict do nothing;
        end if;
        n_new_people := n_new_people + 1;
      else
        n_matched := n_matched + 1;
      end if;

      -- Company: by name (case-insensitive), created when there is none; never overwrites a company
      -- the person already has.
      v_cname := nullif(btrim(coalesce(r.company_name, '')), '');
      if v_cname is not null and not exists (
        select 1 from public.data_records p where p.id = v_person and p.values ? 'company'
      ) then
        select c.id into v_company from public.data_records c
        where c.org_owner_id = p_org and c.object_id = v_companies and c.deleted_at is null
          and lower(btrim(c.name)) = lower(v_cname)
        order by c.created_at limit 1;
        if v_company is null then
          insert into public.data_records (org_owner_id, object_id, name, values)
          values (p_org, v_companies, v_cname, '{}'::jsonb)
          returning id into v_company;
          n_new_companies := n_new_companies + 1;
        end if;
        update public.data_records
        set values = values || jsonb_build_object('company', v_company::text)
        where id = v_person and org_owner_id = p_org;
      end if;

      v_stage := null;
      if r.stage_name is not null then
        select s.id into v_stage from public.data_list_stages s
        where s.list_id = v_list and lower(btrim(s.name)) = lower(btrim(r.stage_name));
      end if;

      v_entry := null;
      insert into public.data_list_entries
        (org_owner_id, list_id, record_id, stage_id, values, position, stage_entered_at, added_by, legacy_source, legacy_id, created_at)
      values (
        p_org, v_list, v_person, v_stage,
        jsonb_strip_nulls(jsonb_build_object(
          'score', r.score::text,
          'staff', case when btrim(coalesce(r.staff_name, '')) in ('', 'Unassigned') then null else btrim(r.staff_name) end
        )),
        n_entries + 1, coalesce(r.stage_updated_at, r.created_at), r.user_id, 'leads', r.id, r.created_at
      )
      on conflict do nothing
      returning id into v_entry;
      if v_entry is null then n_duplicates := n_duplicates + 1; else n_entries := n_entries + 1; end if;

      -- Interactions logged on the lead become notes on the person.
      with ins as (
        insert into public.data_notes (org_owner_id, record_id, kind, body, created_by, legacy_source, legacy_id, created_at)
        select p_org, v_person, lower(i.interaction_type),
               left(coalesce(nullif(btrim(i.notes), ''), i.interaction_type), 10000),
               i.user_id, 'lead_interactions', i.id, i.created_at
        from public.lead_interactions i
        where i.lead_id = r.id and lower(i.interaction_type) in ('note', 'call', 'email', 'meeting')
        on conflict do nothing
        returning 1
      )
      select count(*) into v_n from ins;
      n_notes := n_notes + v_n;
    end loop;

    -- The contact book's notes and logged calls, on the matching person.
    with ins as (
      insert into public.data_notes (org_owner_id, record_id, kind, body, created_by, legacy_source, legacy_id, created_at)
      select p_org, rec.id, case n.kind when 'call' then 'call' else 'note' end,
             left(n.body, 10000), n.created_by, 'crm_contact_notes', n.id, n.created_at
      from public.crm_contact_notes n
      join public.directory_contacts d on d.id = n.contact_id and d.mailbox_owner_id = p_org
      join lateral (
        select coalesce(
          (select x.id from public.data_records x
           where x.org_owner_id = p_org and x.legacy_source = 'directory_contacts' and x.legacy_id = d.id and x.deleted_at is null),
          (select k.record_id from public.data_record_keys k
           where k.org_owner_id = p_org and k.object_id = v_people and k.kind = 'email'
             and k.value = lower(btrim(coalesce(d.email, ''))))
        ) as id
      ) rec on rec.id is not null
      where btrim(n.body) <> ''
      on conflict do nothing
      returning 1
    )
    select count(*) into n_contact_notes from ins;

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
    'stages_created', n_stages,
    'leads_added_to_list', n_entries,
    'leads_skipped_same_person_already_on_list', n_duplicates,
    'people_created_from_leads', n_new_people,
    'leads_matched_to_existing_people', n_matched,
    'companies_created', n_new_companies,
    'interactions_copied_as_notes', n_notes,
    'contact_notes_copied', n_contact_notes
  );
end;
$$;

revoke all on function public.data_model_backfill_leads(uuid, boolean) from public, anon, authenticated;
grant execute on function public.data_model_backfill_leads(uuid, boolean) to service_role;

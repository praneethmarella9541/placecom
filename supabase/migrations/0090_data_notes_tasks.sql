-- Flexible data model: notes, tasks, time-in-stage targets, and the shared Deals pipeline.
--
--   data_notes   free-text notes and logged calls, emails and meetings on a record.
--   data_tasks   to-dos on a record, with a due date and an optional assignee.
--   data_list_stages.target_days   how long a card may sit in a stage before it is flagged late.
--   data_model_seed(org)   replaced: now also creates the "Deals pipeline" list and its stages.
--
-- Same access rule as 0086: RLS on, no policies, service role only, every route scopes by org.
-- Undo with supabase/rollbacks/0090_data_notes_tasks.down.sql.

create table if not exists public.data_notes (
  id             uuid primary key default gen_random_uuid(),
  org_owner_id   uuid not null references auth.users (id) on delete cascade,
  record_id      uuid not null,
  kind           text not null default 'note' check (kind in ('note', 'call', 'email', 'meeting')),
  body           text not null check (length(btrim(body)) > 0 and length(body) <= 10000),
  created_by     uuid references auth.users (id) on delete set null,
  -- Where a note came from when the old CRM was copied in (0091); lets that copy be re-run.
  legacy_source  text,
  legacy_id      uuid,
  created_at     timestamptz not null default now(),
  foreign key (record_id, org_owner_id) references public.data_records (id, org_owner_id) on delete cascade,
  constraint data_notes_legacy_pair check ((legacy_source is null) = (legacy_id is null))
);
create index if not exists data_notes_record_idx on public.data_notes (org_owner_id, record_id, created_at desc);
create unique index if not exists data_notes_legacy_key
  on public.data_notes (org_owner_id, legacy_source, legacy_id) where legacy_source is not null;

create table if not exists public.data_tasks (
  id             uuid primary key default gen_random_uuid(),
  org_owner_id   uuid not null references auth.users (id) on delete cascade,
  record_id      uuid not null,
  title          text not null check (length(btrim(title)) > 0 and length(title) <= 300),
  due_date       date,
  assignee_id    uuid references auth.users (id) on delete set null,
  done_at        timestamptz,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  foreign key (record_id, org_owner_id) references public.data_records (id, org_owner_id) on delete cascade
);
create index if not exists data_tasks_record_idx on public.data_tasks (org_owner_id, record_id, created_at desc);
create index if not exists data_tasks_open_idx on public.data_tasks (org_owner_id, assignee_id, due_date) where done_at is null;

alter table public.data_list_stages add column if not exists target_days integer
  check (target_days is null or (target_days > 0 and target_days <= 3650));

alter table public.data_notes enable row level security;
alter table public.data_tasks enable row level security;

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
  -- Deals move through shared stages. The pipeline is a list on Deals, so it gets the same board,
  -- stage history and per-stage timing as every other list; new deals are added to it automatically
  -- (lib/data-model/records.ts).
  insert into public.data_lists (org_owner_id, object_id, slug, name, has_stages)
  select p_org, o.id, 'deals_pipeline', 'Deals pipeline', true
  from public.data_objects o
  where o.org_owner_id = p_org and o.slug = 'deals'
  on conflict (org_owner_id, slug) do nothing;

  insert into public.data_list_stages (org_owner_id, list_id, name, position, is_closed)
  select p_org, l.id, st.name, st.pos, st.closed
  from public.data_lists l
  join (values
    ('New', 1, false), ('Meeting', 2, false), ('Proposal', 3, false),
    ('Negotiation', 4, false), ('Won', 5, true), ('Lost', 6, true)
  ) as st(name, pos, closed) on true
  where l.org_owner_id = p_org and l.slug = 'deals_pipeline'
  -- Only when the pipeline has no stages yet, so a renamed or reordered pipeline is left alone.
  and not exists (select 1 from public.data_list_stages x where x.list_id = l.id)
  on conflict (list_id, name) do nothing;
end;
$$;

-- Callers can't run it themselves (see 0087); the grants are re-stated because a replaced function
-- keeps its old ones, and that is what we want.
revoke all on function public.data_model_seed(uuid) from public, anon, authenticated;
grant execute on function public.data_model_seed(uuid) to service_role;

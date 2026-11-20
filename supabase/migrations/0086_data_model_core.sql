-- Flexible data model, version 1: the tables behind objects, attributes, records, lists and the
-- edit history. Attio-style: People, Companies and Deals are *objects*; what a person has (job
-- title, phone numbers, company...) is a row in data_attributes instead of a column in code.
--
-- Nothing here changes how the app behaves today. The old tables (directory_contacts,
-- synced_contacts, leads, crm_stages, lead_interactions) are not touched, and the `dataModel`
-- module ships switched off. 0087 adds a function that copies the old data in (dry run first).
--
-- Tenant: org_owner_id is the same id BYOM uses (the admin's auth user id; profiles.mailbox_owner_id
-- on staff). Enforcement follows 0084: RLS on, NO policies, so only the service role reads or
-- writes. Every API route under /api/data resolves the org from the signed-in user and scopes each
-- query by it (lib/data-model/access.ts). One enforcement style for the whole feature.
--
-- Storage: a record has typed core columns (name) plus one JSONB `values` object keyed by attribute
-- slug. Values that must be unique per org (an email address, a company domain) are also written
-- to data_record_keys, whose unique index is what stops two People sharing an email.
--
-- Undo with supabase/rollbacks/0086_data_model_core.down.sql.
-- Check with supabase/rollbacks/0086_data_model_core.verify.sql.

-- ---------------------------------------------------------------------------
-- Objects: people, companies, deals, and (later) custom ones.
-- ---------------------------------------------------------------------------

create table if not exists public.data_objects (
  id             uuid primary key default gen_random_uuid(),
  org_owner_id   uuid not null references auth.users (id) on delete cascade,
  slug           text not null check (slug ~ '^[a-z][a-z0-9_]{0,39}$'),
  singular_name  text not null check (length(btrim(singular_name)) > 0),
  plural_name    text not null check (length(btrim(plural_name)) > 0),
  -- System objects (people, companies, deals) cannot be deleted or renamed by slug.
  is_system      boolean not null default false,
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (org_owner_id, slug),
  -- Lets child tables prove a row belongs to the same org as its parent.
  unique (id, org_owner_id)
);

-- ---------------------------------------------------------------------------
-- Attributes: the fields of an object (or, with list_id set, of one list's entries).
-- ---------------------------------------------------------------------------

create table if not exists public.data_attributes (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  object_id     uuid not null,
  -- Null: an attribute of the record itself. Set: an attribute of that list's entries
  -- (for example "Expected salary" on a recruitment pipeline). Foreign key added below.
  list_id       uuid,
  slug          text not null check (slug ~ '^[a-z][a-z0-9_]{0,39}$'),
  name          text not null check (length(btrim(name)) > 0),
  type          text not null check (type in (
                  'text', 'long_text', 'number', 'currency', 'checkbox', 'date', 'timestamp',
                  'rating', 'select', 'multi_select', 'email', 'phone', 'url', 'domain',
                  'record_ref', 'member'
                )),
  is_multi      boolean not null default false,
  -- type-specific settings: select options, record_ref target object, currency code...
  config        jsonb not null default '{}'::jsonb,
  is_system     boolean not null default false,
  is_required   boolean not null default false,
  -- Unique per org within the object. Backed by data_record_keys, so only email and domain.
  is_unique     boolean not null default false,
  position      integer not null default 0,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  foreign key (object_id, org_owner_id) references public.data_objects (id, org_owner_id) on delete cascade,
  constraint data_attributes_unique_only_keyed check (not is_unique or type in ('email', 'domain'))
);

-- One slug per object for record attributes, and one per list for entry attributes.
create unique index if not exists data_attributes_record_slug_key
  on public.data_attributes (object_id, slug) where list_id is null;
create unique index if not exists data_attributes_list_slug_key
  on public.data_attributes (list_id, slug) where list_id is not null;
create index if not exists data_attributes_org_object_idx on public.data_attributes (org_owner_id, object_id);

-- ---------------------------------------------------------------------------
-- Records: one row per person, company, deal...
-- ---------------------------------------------------------------------------

create table if not exists public.data_records (
  id             uuid primary key default gen_random_uuid(),
  org_owner_id   uuid not null references auth.users (id) on delete cascade,
  object_id      uuid not null,
  -- The display name. Core column (not in `values`) so tables sort and search on it cheaply.
  name           text not null default '',
  values         jsonb not null default '{}'::jsonb,
  created_by     uuid references auth.users (id) on delete set null,
  updated_by     uuid references auth.users (id) on delete set null,
  -- Where the row came from when the old tables were copied in (0087): which table and which id.
  -- Lets the copy be re-run without duplicating anything.
  legacy_source  text,
  legacy_id      uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Soft delete: restoring is an update, and history keeps its record.
  deleted_at     timestamptz,
  foreign key (object_id, org_owner_id) references public.data_objects (id, org_owner_id) on delete cascade,
  unique (id, org_owner_id),
  constraint data_records_legacy_pair check ((legacy_source is null) = (legacy_id is null))
);

create unique index if not exists data_records_legacy_key
  on public.data_records (org_owner_id, legacy_source, legacy_id) where legacy_source is not null;
-- Default table view: newest first, one object, live rows only.
create index if not exists data_records_table_idx
  on public.data_records (org_owner_id, object_id, created_at desc, id) where deleted_at is null;
create index if not exists data_records_name_idx
  on public.data_records (org_owner_id, object_id, lower(name)) where deleted_at is null;
create index if not exists data_records_values_idx
  on public.data_records using gin (values jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- Matching keys: the values that identify a record. Unique per org and object.
-- ---------------------------------------------------------------------------

create table if not exists public.data_record_keys (
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  object_id     uuid not null,
  record_id     uuid not null,
  kind          text not null check (kind in ('email', 'domain')),
  -- Lower-cased and trimmed by the writer (lib/data-model/values.ts).
  value         text not null check (value = lower(btrim(value)) and length(value) > 0),
  primary key (org_owner_id, object_id, kind, value),
  foreign key (record_id, org_owner_id) references public.data_records (id, org_owner_id) on delete cascade
);

create index if not exists data_record_keys_record_idx on public.data_record_keys (record_id);

-- ---------------------------------------------------------------------------
-- Lists: a pipeline (or any named group) of records of one object, with stages.
-- ---------------------------------------------------------------------------

create table if not exists public.data_lists (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  object_id     uuid not null,
  slug          text not null check (slug ~ '^[a-z][a-z0-9_]{0,39}$'),
  name          text not null check (length(btrim(name)) > 0),
  -- Whether entries move through stages (a pipeline) or the list is a plain group.
  has_stages    boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  archived_at   timestamptz,
  unique (org_owner_id, slug),
  unique (id, org_owner_id),
  foreign key (object_id, org_owner_id) references public.data_objects (id, org_owner_id) on delete cascade
);

alter table public.data_attributes
  drop constraint if exists data_attributes_list_fk;
alter table public.data_attributes
  add constraint data_attributes_list_fk
  foreign key (list_id, org_owner_id) references public.data_lists (id, org_owner_id) on delete cascade;

-- Stages are shared by everyone in the org (crm_stages, 0055, is per user; the old per-user
-- boards are not carried over — see docs/data-model-v1.md).
create table if not exists public.data_list_stages (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  list_id       uuid not null,
  name          text not null check (length(btrim(name)) > 0),
  color         text,
  position      integer not null default 0,
  -- A closed stage (won, lost, placed...) for reporting; entries can still move out of it.
  is_closed     boolean not null default false,
  created_at    timestamptz not null default now(),
  foreign key (list_id, org_owner_id) references public.data_lists (id, org_owner_id) on delete cascade,
  unique (id, org_owner_id),
  unique (list_id, name)
);

create table if not exists public.data_list_entries (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  list_id       uuid not null,
  record_id     uuid not null,
  stage_id      uuid,
  -- Values of the list's own attributes, keyed by slug, like data_records.values.
  values        jsonb not null default '{}'::jsonb,
  -- Order within a stage on the board.
  position      double precision not null default 0,
  stage_entered_at timestamptz not null default now(),
  added_by      uuid references auth.users (id) on delete set null,
  legacy_source text,
  legacy_id     uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (list_id, org_owner_id) references public.data_lists (id, org_owner_id) on delete cascade,
  foreign key (record_id, org_owner_id) references public.data_records (id, org_owner_id) on delete cascade,
  foreign key (stage_id, org_owner_id) references public.data_list_stages (id, org_owner_id) on delete set null (stage_id),
  unique (list_id, record_id),
  constraint data_list_entries_legacy_pair check ((legacy_source is null) = (legacy_id is null))
);

create unique index if not exists data_list_entries_legacy_key
  on public.data_list_entries (org_owner_id, legacy_source, legacy_id) where legacy_source is not null;
create index if not exists data_list_entries_board_idx on public.data_list_entries (list_id, stage_id, position);
create index if not exists data_list_entries_record_idx on public.data_list_entries (record_id);

-- ---------------------------------------------------------------------------
-- Edit history: written from day one, no screen yet. One row per changed attribute.
-- ---------------------------------------------------------------------------

create table if not exists public.data_record_history (
  id              bigint generated always as identity primary key,
  org_owner_id    uuid not null references auth.users (id) on delete cascade,
  record_id       uuid not null,
  -- Null for a change to the record itself (created, deleted, restored).
  attribute_slug  text,
  action          text not null check (action in ('create', 'update', 'delete', 'restore', 'import')),
  old_value       jsonb,
  new_value       jsonb,
  actor_id        uuid references auth.users (id) on delete set null,
  -- Where the change came from: 'app', 'api', 'import', 'migration'.
  source          text not null default 'app',
  created_at      timestamptz not null default now()
);

-- No foreign key on record_id: history must outlive a hard-deleted record.
create index if not exists data_record_history_record_idx
  on public.data_record_history (org_owner_id, record_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Access: RLS on, no policies. Service role only (see the header).
-- ---------------------------------------------------------------------------

alter table public.data_objects enable row level security;
alter table public.data_attributes enable row level security;
alter table public.data_records enable row level security;
alter table public.data_record_keys enable row level security;
alter table public.data_lists enable row level security;
alter table public.data_list_stages enable row level security;
alter table public.data_list_entries enable row level security;
alter table public.data_record_history enable row level security;

comment on table public.data_records is
  'Flexible data model records (people, companies, deals...). Service role only; every route scopes by org_owner_id.';

-- ---------------------------------------------------------------------------
-- Ship the module switched off on deployments that already saved a config
-- (the shipping default only applies to a fresh row). Idempotent.
-- ---------------------------------------------------------------------------

update public.platform_module_config
set config = jsonb_set(
  config,
  '{disabledModules}',
  coalesce(config->'disabledModules', '[]'::jsonb) || '["dataModel"]'::jsonb
)
where not coalesce(config->'disabledModules', '[]'::jsonb) ? 'dataModel';

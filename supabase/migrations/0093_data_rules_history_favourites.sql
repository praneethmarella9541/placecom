-- Flexible data model: validation rules, stage history, favourites, record highlights.
--
--   data_validation_rules   "when X, Y is required". Two kinds: a record rule (checked whenever a
--                           record is created or changed) and a stage rule (checked when a card
--                           moves into a stage, e.g. a deal's value is required to enter Won).
--   data_list_entry_history every stage a card has been in, with when. Written from now on; it
--                           powers the funnel and time-in-stage report. Cards already on a board
--                           have no past, only their current stage.
--   data_favourites         a person's starred records and lists.
--   data_objects.highlights up to six fields an admin pins to the top of every record page.
--
-- Same access as 0086: RLS on, no policies, service role only, every route scopes by org.
-- Undo with supabase/rollbacks/0093_data_rules_history_favourites.down.sql.

create table if not exists public.data_validation_rules (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  object_id     uuid not null,
  -- 'record': checked on create and update. 'stage': checked when an entry moves into stage_id.
  kind          text not null check (kind in ('record', 'stage')),
  list_id       uuid,
  stage_id      uuid,
  name          text not null check (length(btrim(name)) > 0 and length(name) <= 100),
  -- Record rules only: { attribute, op: eq|neq|empty|not_empty, value? }. Null = always.
  condition     jsonb,
  -- [{ attribute, kind: 'required' | 'empty' }] on the RECORD's fields.
  requirements  jsonb not null default '[]'::jsonb,
  active        boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (object_id, org_owner_id) references public.data_objects (id, org_owner_id) on delete cascade,
  foreign key (list_id, org_owner_id) references public.data_lists (id, org_owner_id) on delete cascade,
  foreign key (stage_id, org_owner_id) references public.data_list_stages (id, org_owner_id) on delete cascade,
  constraint data_validation_rules_kind_scope check (
    (kind = 'record' and list_id is null and stage_id is null) or
    (kind = 'stage' and list_id is not null and stage_id is not null)
  )
);
create index if not exists data_validation_rules_object_idx on public.data_validation_rules (org_owner_id, object_id) where active;

create table if not exists public.data_list_entry_history (
  id            bigint generated always as identity primary key,
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  list_id       uuid not null,
  entry_id      uuid not null,
  from_stage_id uuid,
  to_stage_id   uuid,
  actor_id      uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (list_id, org_owner_id) references public.data_lists (id, org_owner_id) on delete cascade
);
create index if not exists data_list_entry_history_list_idx on public.data_list_entry_history (org_owner_id, list_id, created_at);
create index if not exists data_list_entry_history_entry_idx on public.data_list_entry_history (entry_id);

create table if not exists public.data_favourites (
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('record', 'list')),
  ref_id        uuid not null,
  created_at    timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);
create index if not exists data_favourites_org_idx on public.data_favourites (org_owner_id, user_id);

alter table public.data_objects
  add column if not exists highlights text[] not null default '{}'
  check (cardinality(highlights) <= 6);

alter table public.data_validation_rules enable row level security;
alter table public.data_list_entry_history enable row level security;
alter table public.data_favourites enable row level security;

-- Flexible data model: saved views. A view is a named table setup for one object: which columns
-- show and in what order, the filters, and the sort. Nothing here changes existing behaviour; the
-- tables from 0086 are untouched and the screens fall back to the default view when there are none.
--
-- Personal views belong to their creator. Shared views (is_shared) are visible to the whole org and
-- are created and changed by admins. Access follows 0086: RLS on, no policies, service role only,
-- every route scopes by org_owner_id and checks the creator in code.
--
-- Undo with supabase/rollbacks/0088_data_views.down.sql.

create table if not exists public.data_views (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  object_id     uuid not null,
  name          text not null check (length(btrim(name)) > 0 and length(name) <= 60),
  -- { columns: [slug], filters: [{attribute, op, value}], sort, direction }. Checked by the API
  -- (lib/data-model/view-config.ts); a slug that no longer exists is ignored when the view loads.
  config        jsonb not null default '{}'::jsonb,
  is_shared     boolean not null default false,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (object_id, org_owner_id) references public.data_objects (id, org_owner_id) on delete cascade
);

create index if not exists data_views_object_idx on public.data_views (org_owner_id, object_id);
-- No two shared views with the same name, and none of one person's.
create unique index if not exists data_views_shared_name_key
  on public.data_views (org_owner_id, object_id, lower(name)) where is_shared;
create unique index if not exists data_views_personal_name_key
  on public.data_views (org_owner_id, object_id, created_by, lower(name)) where not is_shared;

alter table public.data_views enable row level security;

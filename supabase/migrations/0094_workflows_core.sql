-- Workflows, version 1: one engine for "when something happens, check, then act".
-- Built on the flexible data model (0086-0093). Ships switched off (the `workflows` module).
--
--   workflows               one row per workflow (name, owner, on/off, which version is live)
--   workflow_versions       every published version, and one working draft per workflow
--   workflow_events         the event log: what happened in the data model, written first
--   workflow_runs           one row per run, pinned to the version it started on
--   workflow_run_steps      one row per block per run: its input, output and any error
--   workflow_notifications  in-app notifications created by the "send notification" block
--
-- Design points (docs/workflows-v1.md):
--   * Events are written to a log; a worker turns them into runs. Nothing polls the data.
--   * A run is pinned to a version, so editing a workflow never changes a run in progress.
--   * (workflow_id, event_id) is unique, so one event can never start the same workflow twice.
--   * The worker leases runs with a claim token, the same pattern as the sequence sender.
--
-- Access follows 0086: RLS on, no policies, service role only; every route scopes by org_owner_id.
-- Undo with supabase/rollbacks/0094_workflows_core.down.sql.

create table if not exists public.workflows (
  id               uuid primary key default gen_random_uuid(),
  org_owner_id     uuid not null references auth.users (id) on delete cascade,
  name             text not null check (length(btrim(name)) > 0 and length(name) <= 100),
  description      text check (description is null or length(description) <= 1000),
  -- Whose identity the workflow acts as. Version 1: an admin.
  owner_id         uuid references auth.users (id) on delete set null,
  status           text not null default 'draft' check (status in ('draft', 'live', 'off')),
  live_version_id  uuid,
  -- A schedule trigger's next fire time; null for every other trigger.
  next_fire_at     timestamptz,
  -- Set when the loop guard or a safety limit paused the workflow; cleared when an admin turns it on.
  flagged_at       timestamptz,
  flag_reason      text,
  deleted_at       timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, org_owner_id)
);
create index if not exists workflows_org_idx on public.workflows (org_owner_id) where deleted_at is null;
create index if not exists workflows_live_idx on public.workflows (org_owner_id) where status = 'live' and deleted_at is null;
create index if not exists workflows_schedule_idx on public.workflows (next_fire_at) where status = 'live' and next_fire_at is not null and deleted_at is null;

create table if not exists public.workflow_versions (
  id              uuid primary key default gen_random_uuid(),
  org_owner_id    uuid not null references auth.users (id) on delete cascade,
  workflow_id     uuid not null,
  -- 0 for the draft; 1, 2, ... for published versions.
  version_no      integer not null default 0,
  is_draft        boolean not null default false,
  -- { start: "b1" | null, blocks: { b1: { type, config, next, yes, no } } } (lib/workflows/graph.ts)
  graph           jsonb not null default '{"start":null,"blocks":{}}'::jsonb,
  trigger_type    text,
  trigger_config  jsonb not null default '{}'::jsonb,
  published_by    uuid references auth.users (id) on delete set null,
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  foreign key (workflow_id, org_owner_id) references public.workflows (id, org_owner_id) on delete cascade,
  unique (id, org_owner_id)
);
create unique index if not exists workflow_versions_one_draft on public.workflow_versions (workflow_id) where is_draft;
create unique index if not exists workflow_versions_number on public.workflow_versions (workflow_id, version_no) where not is_draft;

create table if not exists public.workflow_events (
  id             bigint generated always as identity primary key,
  org_owner_id   uuid not null references auth.users (id) on delete cascade,
  -- record.created, record.updated, attribute.changed, list.added, list.entry_updated, manual
  type           text not null,
  object_slug    text,
  record_id      uuid,
  list_id        uuid,
  entry_id       uuid,
  -- attribute.changed / list.entry_updated: which field ("stage" for a stage move), and its old and new value.
  attribute_slug text,
  old_value      jsonb,
  new_value      jsonb,
  -- Who caused it. 'workflow' events are what the loop guard watches.
  actor_kind     text not null default 'user' check (actor_kind in ('user', 'workflow', 'system')),
  actor_id       uuid,
  source         text,
  payload        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  -- Null until the matcher has looked at it.
  processed_at   timestamptz
);
create index if not exists workflow_events_unprocessed_idx on public.workflow_events (id) where processed_at is null;
create index if not exists workflow_events_org_idx on public.workflow_events (org_owner_id, created_at desc);

create table if not exists public.workflow_runs (
  id             uuid primary key default gen_random_uuid(),
  org_owner_id   uuid not null references auth.users (id) on delete cascade,
  workflow_id    uuid not null,
  version_id     uuid not null,
  event_id       bigint references public.workflow_events (id) on delete set null,
  record_id      uuid,
  status         text not null default 'queued' check (status in ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')),
  -- Where the run is: the block it will run next, how many blocks it has run, retries of this block.
  cursor         jsonb not null default '{}'::jsonb,
  -- What blocks can read: { trigger: {...}, steps: { blockKey: output } }
  context        jsonb not null default '{}'::jsonb,
  attempt_no     integer not null default 1,
  next_run_at    timestamptz not null default now(),
  claimed_at     timestamptz,
  claim_token    uuid,
  error          text,
  -- Why it ended without failing, e.g. a filter whose condition was not met.
  outcome        text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  foreign key (workflow_id, org_owner_id) references public.workflows (id, org_owner_id) on delete cascade,
  foreign key (version_id, org_owner_id) references public.workflow_versions (id, org_owner_id) on delete cascade
);
-- One event starts a given workflow once.
create unique index if not exists workflow_runs_event_once on public.workflow_runs (workflow_id, event_id) where event_id is not null;
create index if not exists workflow_runs_due_idx on public.workflow_runs (next_run_at) where status in ('queued', 'waiting');
create index if not exists workflow_runs_workflow_idx on public.workflow_runs (org_owner_id, workflow_id, created_at desc);
create index if not exists workflow_runs_record_idx on public.workflow_runs (workflow_id, record_id, created_at desc);

create table if not exists public.workflow_run_steps (
  id           bigint generated always as identity primary key,
  org_owner_id uuid not null references auth.users (id) on delete cascade,
  run_id       uuid not null references public.workflow_runs (id) on delete cascade,
  block_key    text not null,
  block_type   text not null,
  -- Which try of this run this belongs to (a retry from the start or from a failed block adds one).
  attempt      integer not null default 1,
  status       text not null check (status in ('succeeded', 'failed', 'stopped')),
  input        jsonb,
  output       jsonb,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists workflow_run_steps_run_idx on public.workflow_run_steps (run_id, id);

create table if not exists public.workflow_notifications (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null check (length(title) <= 200),
  body          text check (body is null or length(body) <= 2000),
  -- An in-app path, e.g. /data/<record id>.
  link          text check (link is null or (link like '/%' and link not like '//%' and length(link) <= 300)),
  workflow_id   uuid,
  run_id        uuid,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists workflow_notifications_user_idx on public.workflow_notifications (user_id, created_at desc);

alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_events enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_run_steps enable row level security;
alter table public.workflow_notifications enable row level security;

-- Ship the module switched off on deployments that already saved a config. Idempotent.
update public.platform_module_config
set config = jsonb_set(
  config,
  '{disabledModules}',
  coalesce(config->'disabledModules', '[]'::jsonb) || '["workflows"]'::jsonb
)
where not coalesce(config->'disabledModules', '[]'::jsonb) ? 'workflows';

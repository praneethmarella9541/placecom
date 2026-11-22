-- Phase 6 of the rules engine: an audit trail of what a rule actually did, and a snapshot of what a
-- rule used to say before each change that bumps its `version` (0101).
--
--   data_rule_evaluation_log      one row per save where a rule mattered: it blocked the save, it
--                                  warned (mode:'warn', the save went through), or an admin's
--                                  explicit bypass let a would-be block through anyway. A rule that
--                                  simply didn't match writes nothing — this is an audit trail, not a
--                                  hit counter. Best effort: see lib/data-model/rule-audit.ts —
--                                  logging must never be the reason a save fails.
--   data_validation_rule_versions a full snapshot of the row immediately before a change, so the
--                                  "version 4 of this rule" from an error message or the admin UI's
--                                  history list can actually be looked at (and, later, restored).
--
-- Same access pattern as 0093/0101/0102: RLS on, no policies, service role only, every route scopes
-- by org. Undo with supabase/rollbacks/0103_rules_audit_and_versions.down.sql.

create table if not exists public.data_rule_evaluation_log (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  rule_id       uuid references public.data_validation_rules (id) on delete set null,
  -- Composite FK (data_objects has no bare unique(id) suitable alone; object_id, org_owner_id does).
  object_id     uuid,
  -- Not a foreign key: a create that was blocked never got a record id, and a log row must outlive
  -- the record it mentions if that record is later deleted.
  record_id     uuid,
  outcome       text not null check (outcome in ('blocked', 'warned', 'bypassed')),
  message       text,
  actor_id      uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (object_id, org_owner_id) references public.data_objects (id, org_owner_id) on delete cascade
);
create index if not exists data_rule_evaluation_log_rule_idx on public.data_rule_evaluation_log (org_owner_id, rule_id, created_at desc);

create table if not exists public.data_validation_rule_versions (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  rule_id       uuid not null references public.data_validation_rules (id) on delete cascade,
  -- The version NUMBER this snapshot is of (the row as it was before becoming this version).
  version       integer not null,
  snapshot      jsonb not null,
  changed_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (rule_id, version)
);
create index if not exists data_validation_rule_versions_rule_idx on public.data_validation_rule_versions (org_owner_id, rule_id, version desc);

alter table public.data_rule_evaluation_log enable row level security;
alter table public.data_validation_rule_versions enable row level security;

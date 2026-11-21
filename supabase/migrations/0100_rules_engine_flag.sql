-- Per-tenant rollout switch for the new formula-based rules engine (lib/rules-engine), so it can be
-- turned on for one workspace at a time while every other workspace keeps running today's simpler
-- condition+requirements rules unchanged. See lib/data-model/rule-engine-bridge.ts: with the switch
-- off (the default, and what a missing row or a missing table both mean), record and stage rules are
-- evaluated exactly as before this migration — nothing about today's behaviour changes until a row
-- here explicitly turns a workspace on.
--
-- Same access pattern as 0086/0093: RLS on, no policies, service role only, every route scopes by org.
-- Undo with supabase/rollbacks/0100_rules_engine_flag.down.sql.

create table if not exists public.data_rules_feature_flags (
  org_owner_id    uuid primary key references auth.users (id) on delete cascade,
  formula_engine  boolean not null default false,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

alter table public.data_rules_feature_flags enable row level security;

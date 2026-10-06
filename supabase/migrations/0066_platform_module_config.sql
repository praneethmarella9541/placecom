-- Platform-level module configuration, edited from /configs.
--
-- Deployment-wide (not per team), so this is a singleton row: the `id` column
-- is a boolean pinned to true by a CHECK, which makes a second row impossible
-- and lets every reader upsert against a known primary key.
--
-- Stores what is switched OFF rather than what is on, so a module added to
-- FEATURE_KEYS in a future release defaults to available instead of silently
-- vanishing until someone edits this row.

create table if not exists public.platform_module_config (
  id boolean primary key default true,
  constraint platform_module_config_singleton check (id),
  -- { "disabledGroups": ["data"], "disabledModules": ["sms"] }
  config jsonb not null default '{"disabledGroups": [], "disabledModules": []}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- Seed the state the app shipped with, so a fresh deployment looks exactly like
-- it did before /configs existed:
--   sms, dashboard  - had working pages, APIs, and feature keys but no sidebar
--                     entry, so no user could reach them.
--   whatsapp        - deleted outright in 7db62ea and restored later; nobody had
--                     it while it was gone, so turning it on should be a
--                     deliberate choice rather than a side effect of deploying.
--
-- Keep this list in sync with DEFAULT_MODULE_CONFIG in lib/module-config.ts,
-- which is what the app falls back to when this row is missing.
--
-- `on conflict do nothing` means this never overwrites a config an operator has
-- already saved -- re-running the migration cannot undo their toggles.
insert into public.platform_module_config (id, config)
values (
  true,
  '{"disabledGroups": [], "disabledModules": ["sms", "dashboard", "whatsapp"]}'::jsonb
)
on conflict (id) do nothing;

alter table public.platform_module_config enable row level security;

-- Which modules exist is not a secret, and middleware reads it on every
-- request with the caller's own client — so any signed-in user may read it.
drop policy if exists platform_module_config_read on public.platform_module_config;
create policy platform_module_config_read
  on public.platform_module_config
  for select
  to authenticated
  using (true);

-- No insert/update/delete policy on purpose: writes go through
-- /api/configs/modules with the service-role key, which is gated on the
-- CONFIGS_ALLOWED_EMAILS allowlist. RLS therefore denies every client write.

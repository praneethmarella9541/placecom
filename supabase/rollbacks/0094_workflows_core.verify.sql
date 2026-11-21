-- Read-only checks for 0094. Run each block separately in the SQL editor.

-- 1. The module ships off. Expect true.
select config->'disabledModules' ? 'workflows' from public.platform_module_config;

-- 2. Empty after deploy. Expect 0 from each.
select (select count(*) from public.workflows) w, (select count(*) from public.workflow_events) e, (select count(*) from public.workflow_runs) r;

-- 3. The signed-in role can't read them (RLS, no policies). Expect 0 rows from each.
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  select count(*) from public.workflows;
  select count(*) from public.workflow_runs;
  select count(*) from public.workflow_notifications;
rollback;

-- 4. One live version per workflow whose status is live. Expect no rows.
select id, name from public.workflows where status = 'live' and live_version_id is null and deleted_at is null;

-- 5. Runs stuck running for over 10 minutes (a worker died mid-run). Expect no rows; the next tick re-claims them.
select id, workflow_id, claimed_at from public.workflow_runs where status = 'running' and claimed_at < now() - interval '10 minutes';

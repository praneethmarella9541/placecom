-- Undo 0094. Drops every workflow, version, event, run and notification.
drop table if exists public.workflow_notifications;
drop table if exists public.workflow_run_steps;
drop table if exists public.workflow_runs;
drop table if exists public.workflow_events;
drop table if exists public.workflow_versions;
drop table if exists public.workflows;

update public.platform_module_config
set config = jsonb_set(config, '{disabledModules}', (config->'disabledModules') - 'workflows')
where config->'disabledModules' ? 'workflows';

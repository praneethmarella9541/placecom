-- Undo 0084 and 0085 (BYOM). Drops every individual-mailbox link and access grant.
-- Google credentials (google_mailbox_credentials) are untouched; individual users keep
-- their login but land on /no-access unless an admin adds them to the team.

alter table public.sequences       drop column if exists mailbox_id;
alter table public.email_responses drop column if exists mailbox_id;
alter table public.email_tracking  drop column if exists mailbox_id;

-- Only exists where an early draft (invite by email, since removed) was applied.
drop table if exists public.org_signup_invites;
drop table if exists public.org_signup_domains;
drop table if exists public.user_mailbox_permissions;
drop table if exists public.mailboxes;

update public.platform_module_config
set config = jsonb_set(config, '{disabledModules}', (config->'disabledModules') - 'byom')
where config->'disabledModules' ? 'byom';

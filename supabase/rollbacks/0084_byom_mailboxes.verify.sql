-- Read-only checks for 0084/0085. Run each block separately in the SQL editor.

-- 1. One common mailbox per admin. Expect no rows.
select p.id as admin_without_common_mailbox
from public.profiles p
where p.role = 'admin'
  and not exists (select 1 from public.mailboxes m where m.org_owner_id = p.id and m.mailbox_type = 'common');

-- 2. No permission rows yet (existing staff keep implicit full access). Expect 0 right after deploy.
select count(*) from public.user_mailbox_permissions;

-- 3. The module ships off. Expect true.
select config->'disabledModules' ? 'byom' from public.platform_module_config;

-- 4. The signed-in role can't read the new tables. Expect 0 rows from each (RLS, no policies).
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  select count(*) from public.mailboxes;
  select count(*) from public.user_mailbox_permissions;
  select count(*) from public.org_signup_domains;
rollback;

-- 5. New columns exist and are null on existing rows. Expect 0.
select count(*) from public.email_tracking where mailbox_id is not null;

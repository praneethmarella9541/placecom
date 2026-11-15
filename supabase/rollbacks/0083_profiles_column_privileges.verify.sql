-- Read-only checks for 0083. Run each block separately in the SQL editor. Nothing is changed:
-- the write tests run in transactions that are rolled back.

-- 1. Which columns can the signed-in role update? Expect exactly: bio, display_username, job_title, updated_at.
select column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and privilege_type = 'UPDATE' and grantee = 'authenticated'
order by column_name;

-- 2. Can `anon` update anything? Expect no rows.
select column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'profiles'
  and privilege_type = 'UPDATE' and grantee = 'anon';

-- 3. Behave like a signed-in user (replace the uuid with a real user id, ideally a staff test user).
--    Expect: "permission denied for table profiles".
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-000000000000';
rollback;

-- 4. Same user, an allowed column. Expect: UPDATE 1 (then rolled back).
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  update public.profiles set display_username = display_username where id = '00000000-0000-0000-0000-000000000000';
rollback;

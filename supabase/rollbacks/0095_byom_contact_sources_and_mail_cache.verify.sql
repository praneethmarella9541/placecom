-- Read-only checks for 0095. Run each block separately in the SQL editor.

-- 1. Every synced contact has at least one source. Expect 0.
select count(*) from public.synced_contacts sc
where not exists (
  select 1 from public.synced_contact_sources s
  where s.org_owner_id = sc.mailbox_owner_id and s.email = sc.email
);

-- 2. Mail-cache RLS: a signed-in user sees only rows of their own individual mailbox or a
--    common mailbox they may read. Replace the uuid with a real BYOM user; expect no row whose
--    mailbox is another user's individual mailbox (second column false for all).
begin;
  set local role authenticated;
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
  select t.mailbox_id, m.mailbox_type, m.owner_user_id
  from public.contact_mail_threads t join public.mailboxes m on m.id = t.mailbox_id
  where m.mailbox_type = 'individual' and m.owner_user_id <> auth.uid();
rollback;

-- 3. The cache holds no message bodies or snippets (column list). Expect no 'body'/'snippet'.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'contact_mail_threads'
  and column_name in ('body', 'snippet');

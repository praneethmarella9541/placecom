-- Signed-in users could rewrite their own `role` and `mailbox_owner_id`.
--
-- `profiles_update_own` (0015) only checks `auth.uid() = id`, and the `authenticated` and `anon`
-- roles held UPDATE on every column. With sign-ups open, anyone could sign in and PATCH their own
-- row through the REST API to become an admin, or point `mailbox_owner_id` at another admin's
-- workspace and use its shared Gmail.
--
-- The app only edits these columns as the signed-in user (app/api/me/profile, app/api/me/display-name):
-- display_username, job_title, bio, updated_at. Everything else (role, mailbox_owner_id,
-- restricted_features, group_id, openai_token_limit, telephony, ...) is written by admin routes
-- with the service role, which bypasses these grants. The mobile app only reads `profiles`.
--
-- Revoking the table-level privilege also drops any column-level grants, so the order matters:
-- revoke first, then grant back the editable columns.
--
-- Undo with supabase/rollbacks/0083_profiles_column_privileges.down.sql.
-- Check with supabase/rollbacks/0083_profiles_column_privileges.verify.sql.

revoke update on table public.profiles from anon, authenticated;

grant update (display_username, job_title, bio, updated_at)
  on table public.profiles
  to authenticated;

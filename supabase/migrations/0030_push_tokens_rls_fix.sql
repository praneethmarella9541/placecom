-- Upsert needs WITH CHECK on UPDATE (Postgres RLS).
drop policy if exists push_device_tokens_update_own on public.push_device_tokens;

create policy push_device_tokens_update_own on public.push_device_tokens
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

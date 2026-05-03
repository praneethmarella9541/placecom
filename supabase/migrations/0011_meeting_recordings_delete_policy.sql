-- Idempotent: safe if you already created this policy manually in the SQL editor.
drop policy if exists "Users can delete their own meeting recordings" on public.meeting_recordings;

create policy "Users can delete their own meeting recordings"
  on public.meeting_recordings for delete
  using ( auth.uid() = user_id );

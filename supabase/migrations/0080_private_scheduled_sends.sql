-- Scheduled sends (and sequences) are private to the person who created them; the mailbox owner
-- (admin) still sees everything on their mailbox.
--
-- The /api/sequences routes use the service role and enforce this themselves
-- (lib/sequence-server.ts: loadOwnedSequence and the list route). These policies cover the other
-- door: a signed-in user reading the tables directly with their own token, which until now showed
-- everyone on the mailbox the same rows.
--
-- Who counts as the owner: the helper maps an admin to their own id, so `mailbox_owner_id =
-- auth.uid()` is "I am the admin of this mailbox". A row whose creator was deleted (created_by is
-- set null) is therefore visible to the admin only.
--
-- Child tables follow the sequence: the sub-select runs under the caller's own RLS on
-- public.sequences, so a step, recipient or send is visible exactly when its sequence is.

-- ─── sequences ─────────────────────────────────────────────────────────────
drop policy if exists "sequences_select_team" on public.sequences;
create policy "sequences_select_team" on public.sequences
  for select to authenticated
  using (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and (created_by = (select auth.uid()) or mailbox_owner_id = (select auth.uid()))
  );

drop policy if exists "sequences_update_team" on public.sequences;
create policy "sequences_update_team" on public.sequences
  for update to authenticated
  using (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and (created_by = (select auth.uid()) or mailbox_owner_id = (select auth.uid()))
  )
  with check (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and (created_by = (select auth.uid()) or mailbox_owner_id = (select auth.uid()))
  );

drop policy if exists "sequences_delete_team" on public.sequences;
create policy "sequences_delete_team" on public.sequences
  for delete to authenticated
  using (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and (created_by = (select auth.uid()) or mailbox_owner_id = (select auth.uid()))
  );

-- Insert is unchanged (any member may create one on their mailbox), but a new row must be theirs.
drop policy if exists "sequences_insert_team" on public.sequences;
create policy "sequences_insert_team" on public.sequences
  for insert to authenticated
  with check (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and (created_by is null or created_by = (select auth.uid()))
  );

-- ─── steps ─────────────────────────────────────────────────────────────────
drop policy if exists "sequence_steps_select_team" on public.sequence_steps;
create policy "sequence_steps_select_team" on public.sequence_steps
  for select to authenticated
  using (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and exists (select 1 from public.sequences s where s.id = sequence_steps.sequence_id)
  );

drop policy if exists "sequence_steps_update_team" on public.sequence_steps;
create policy "sequence_steps_update_team" on public.sequence_steps
  for update to authenticated
  using (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and exists (select 1 from public.sequences s where s.id = sequence_steps.sequence_id)
  )
  with check (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and exists (select 1 from public.sequences s where s.id = sequence_steps.sequence_id)
  );

drop policy if exists "sequence_steps_delete_team" on public.sequence_steps;
create policy "sequence_steps_delete_team" on public.sequence_steps
  for delete to authenticated
  using (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and exists (select 1 from public.sequences s where s.id = sequence_steps.sequence_id)
  );

-- Insert: the parent sequence must be visible to the caller too, so nobody can attach a step to
-- someone else's send.
drop policy if exists "sequence_steps_insert_team" on public.sequence_steps;
create policy "sequence_steps_insert_team" on public.sequence_steps
  for insert to authenticated
  with check (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and exists (select 1 from public.sequences s where s.id = sequence_steps.sequence_id)
  );

-- ─── recipients, sends, attachments (read-only for users) ─────────────────
drop policy if exists "sequence_enrollments_select_team" on public.sequence_enrollments;
create policy "sequence_enrollments_select_team" on public.sequence_enrollments
  for select to authenticated
  using (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and exists (select 1 from public.sequences s where s.id = sequence_enrollments.sequence_id)
  );

drop policy if exists "sequence_sends_select_team" on public.sequence_sends;
create policy "sequence_sends_select_team" on public.sequence_sends
  for select to authenticated
  using (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and exists (select 1 from public.sequences s where s.id = sequence_sends.sequence_id)
  );

drop policy if exists sequence_step_attachments_rw on public.sequence_step_attachments;
create policy sequence_step_attachments_rw on public.sequence_step_attachments
  for all
  using (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and exists (select 1 from public.sequences s where s.id = sequence_step_attachments.sequence_id)
  )
  with check (
    mailbox_owner_id = (select public.current_mailbox_owner_id())
    and exists (select 1 from public.sequences s where s.id = sequence_step_attachments.sequence_id)
  );

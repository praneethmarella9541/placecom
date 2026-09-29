-- migration 0002 gave email_tracking select/insert/delete policies for the
-- owning user but no update policy — fine while only the tracking-pixel
-- endpoint (service_role, bypasses RLS) ever wrote to a row after insert.
-- The new campaign report (app/api/campaigns/[campaignId]/route.ts) updates
-- replied/bounced through the signed-in user's own RLS-scoped client, which
-- Postgres silently denies with no matching policy — the write looked like
-- it succeeded (no exception; the campaigns route just wasn't checking the
-- result) while the row never actually changed.

create policy "email_tracking_update_own"
  on public.email_tracking for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

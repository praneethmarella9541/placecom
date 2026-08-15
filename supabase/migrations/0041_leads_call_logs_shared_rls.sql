-- Widen leads + call_logs from owner-only reads to team-shared reads, so the contact
-- detail page's Active Deal Info and Calls timeline show the whole team's history
-- with a contact, not just the viewing user's own rows. Write policies are untouched —
-- you still only create/edit/delete your own lead and call rows.

drop policy if exists "leads_select_own" on public.leads;
create policy "leads_select_shared"
  on public.leads
  for select
  to authenticated
  using (true);

drop policy if exists "call_logs_select_own" on public.call_logs;
create policy "call_logs_select_shared"
  on public.call_logs
  for select
  to authenticated
  using (true);

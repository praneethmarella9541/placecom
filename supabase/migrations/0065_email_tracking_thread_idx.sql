-- lib/tracking-passive-sync.ts looks up email_tracking by (user_id,
-- gmail_thread_id) every time a thread is opened in the inbox, to passively
-- detect a reply/bounce without ever calling the Gmail API just to check —
-- see that file's doc comment. Index it the same way the campaign_id lookup
-- already is (migration 0063), scoped to rows that still have something to
-- resolve, which is the common case once a mailbox has any history.
create index if not exists email_tracking_thread_pending_idx
  on public.email_tracking (user_id, gmail_thread_id)
  where gmail_thread_id is not null and not replied and not bounced;

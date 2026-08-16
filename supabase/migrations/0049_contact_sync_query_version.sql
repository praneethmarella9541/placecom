-- Narrows the contact sync's backfill scope to genuine two-way correspondence
-- (Inbox + Sent, minus drafts/chats/promotions/social — see BACKFILL_QUERY in
-- lib/people-mailbox-sync.ts) instead of scanning every message in the mailbox.
-- No date bound: the full history is still scanned, however far back it goes.
--
-- Gmail's list pagination is bound to the query that produced a page_token, so
-- a token stored under the previous (unfiltered) scan can't be resumed against
-- the new query. This column records which query version the stored cursor
-- belongs to; runBackfillPhase restarts from the top whenever it doesn't match
-- the code's current BACKFILL_QUERY_VERSION. Null on existing rows, so every
-- in-flight backfill restarts once under the new filter — the re-scan is safe,
-- since contact writes are idempotent upserts keyed on (mailbox_owner_id, email).
--
-- Mailboxes that already finished a backfill are NOT re-run (phase selection
-- still keys off completed_backfill_at); they simply pick up the equivalent
-- label-based filter on the incremental path from here on.

alter table public.contact_sync_state
  add column if not exists query_version text;

comment on column public.contact_sync_state.query_version is
  'BACKFILL_QUERY_VERSION (lib/people-mailbox-sync.ts) that the stored page_token belongs to. A mismatch means the scan scope changed and the cursor is no longer resumable, so backfill restarts from the top.';

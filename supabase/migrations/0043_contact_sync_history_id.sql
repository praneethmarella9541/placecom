-- Switches the contact sync's incremental phase from an `after:<date>` search
-- rescan (approximate — can double-count or miss messages at the exact-second
-- boundary) to Gmail's history.list changelog (exact, cheaper). See
-- lib/people-mailbox-sync.ts. Backfill is unaffected — this only changes what
-- happens once completed_backfill_at is set.

alter table public.contact_sync_state
  add column if not exists history_id text;

comment on column public.contact_sync_state.history_id is
  'Gmail history cursor captured once backfill completes; incremental syncs page history.list from here instead of rescanning by date. Expires after ~30 days idle — on a 404 the batch runner falls back to a bounded after:<date> catch-up and re-captures a fresh one.';

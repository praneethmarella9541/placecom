-- Raw per-message dates (capped to the most recent 300, newest first) so the
-- "min messages in the last N days" bucketing rule can compute an arbitrary
-- window live at read time, instead of only ever answering "in the last 90
-- days" — the single fixed window message_count_90d was rolled up into at
-- sync time. Capping at 300 rather than storing full history: any contact
-- with more messages than that inside whatever window a user picks has
-- already cleared any realistic min-message threshold regardless of the
-- exact count past that point, so the cap never causes a false negative in
-- practice while keeping row size bounded.
--
-- Stored as epoch-ms integers in a jsonb array — see
-- lib/people-mailbox-sync.ts for how it's maintained (merged with existing,
-- deduped, capped, newest first) and lib/email-connection-strength.ts for
-- how it's read.

alter table public.synced_contacts
  add column if not exists recent_message_dates jsonb not null default '[]'::jsonb;

comment on column public.synced_contacts.recent_message_dates is
  'Most recent 300 message epoch-ms dates (either direction), newest first — lets bucketing compute "N messages in the last W days" for any W, not just a fixed 90.';

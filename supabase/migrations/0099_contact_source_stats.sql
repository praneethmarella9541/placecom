-- Per-mailbox interaction stats on a shared contact.
--
-- synced_contact_sources (0095) records that a mailbox saw an address, with that mailbox's last
-- interaction and total count. The Data tab's record page wants to show last interaction,
-- connection strength and mail volume FOR ONE KIND OF MAILBOX (common / BYOM / my own), and
-- connection strength needs what synced_contacts keeps for the merged contact: the 90-day count,
-- recent message dates, and whether any mail was sent to or addressed to the person. This adds the
-- same four columns per mailbox. Contact metadata only — dates and counts, never mail.
--
-- Common-mailbox rows are filled from the merged contact now (the common mailbox is where those
-- came from). BYOM rows filled in so far have only the total and last date; the next sync of that
-- mailbox (a fresh backfill) fills in the rest, and until then strength falls back to the totals.
-- Needs 0095. Undo with supabase/rollbacks/0099_contact_source_stats.down.sql.

alter table public.synced_contact_sources
  add column if not exists message_count_90d    int not null default 0,
  add column if not exists recent_message_dates jsonb not null default '[]'::jsonb,
  add column if not exists has_outbound_contact boolean not null default false,
  add column if not exists has_direct_contact   boolean not null default true;

update public.synced_contact_sources s
   set message_count_90d    = sc.message_count_90d,
       recent_message_dates = sc.recent_message_dates,
       has_outbound_contact = sc.has_outbound_contact,
       has_direct_contact   = sc.has_direct_contact
  from public.synced_contacts sc, public.mailboxes m
 where m.id = s.mailbox_id and m.mailbox_type = 'common'
   and sc.mailbox_owner_id = s.org_owner_id and sc.email = s.email;

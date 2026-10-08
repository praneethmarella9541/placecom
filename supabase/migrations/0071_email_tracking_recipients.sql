-- Who an email went to, and who it failed for — per address, not per email.
--
-- email_tracking only kept the To line, so a delivery failure for a CC or BCC
-- address could never be matched to its email, and one bad address among
-- several marked the whole email "Bounced" even though the rest received it.
--
--  - cc_address / bcc_address: stored with each send, alongside to_address.
--  - bounced_recipients: the addresses a delivery-failure notice named. The
--    inbox shows "Partly bounced · 1 of 3" when only some failed, and admin
--    analytics counts each failed address.
--
-- `bounced` stays true when any recipient failed, so existing readers keep
-- working. Rows from before this migration have no bounced_recipients; they
-- count as one failed address when bounced (CC/BCC of past sends can't be
-- recovered).

alter table public.email_tracking
  add column if not exists cc_address text,
  add column if not exists bcc_address text,
  add column if not exists bounced_recipients text[] not null default '{}';

comment on column public.email_tracking.bounced_recipients is
  'Lower-cased addresses this email could not be delivered to (from delivery-failure notices).';

-- Tracks whether a synced contact was ever a direct participant (From, for
-- mail they sent; To, for mail sent to them) versus only ever appearing in
-- Cc — previously every address in From/To/Cc counted identically toward a
-- contact's activity, so someone who was only ever cc'd on threads (never
-- actually addressed) could still rack up recent/frequent "messages" and
-- get bucketed as Good/Weak. See lib/people-mailbox-sync.ts's per-message
-- role tracking and lib/email-connection-strength.ts's
-- treatCcOnlyAsNoCommunication setting, which this feeds.
--
-- Defaults true (benefit of the doubt) rather than false: existing rows
-- were synced before this column existed, so there's no way to know their
-- real direct/cc-only status without a fresh sync re-touching them —
-- defaulting to false would misclassify a large batch of legitimate direct
-- contacts as "cc-only" purely because nothing new has arrived from them
-- since this shipped (same staleness caveat as has_outbound_contact).

alter table public.synced_contacts
  add column if not exists has_direct_contact boolean not null default true;

comment on column public.synced_contacts.has_direct_contact is
  'True if ever seen in From (inbound) or To (outbound) — false only once a sync has actually observed them as Cc-only.';

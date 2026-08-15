-- Tracks whether the shared mailbox has ever *sent* mail to this address, not
-- just received it. Real business relationships are two-way; a domain like
-- Substack/Quora/a bank's statements service shows up with lots of inbound
-- mail and zero outbound — this is the durable, non-denylist signal used to
-- keep those out of the People/Companies views (see lib/people-mailbox-sync.ts).

alter table public.synced_contacts
  add column if not exists has_outbound_contact boolean not null default false;

create index if not exists synced_contacts_has_outbound_idx on public.synced_contacts (has_outbound_contact);

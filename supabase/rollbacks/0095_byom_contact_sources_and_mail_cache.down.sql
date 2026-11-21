-- Undo 0095. Contact sources and the mail cache are derived data; both rebuild from the mailboxes.
drop table if exists public.contact_mail_fetches;
drop table if exists public.contact_mail_threads;
drop table if exists public.synced_contact_sources;
drop function if exists public.user_can_read_mailbox_mail(uuid);

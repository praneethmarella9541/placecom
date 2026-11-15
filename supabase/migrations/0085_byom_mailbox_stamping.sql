-- Records which mailbox a send, a reply and a sequence belong to (BYOM, 0084),
-- so analytics can split a member's activity between their own mailbox and the
-- common one, and the sequences cron sends from the right account.
--
-- All nullable, and nothing is backfilled. Only rows that belong to an
-- INDIVIDUAL mailbox carry an id; the common mailbox is always null — for
-- existing rows and new ones alike (activityMailboxId in
-- lib/mailbox-context-shared.ts). So a common-mailbox view is simply
-- `mailbox_id is null`, and an individual mailbox's rows can't surface there
-- even if BYOM is switched off later.

alter table public.email_tracking
  add column if not exists mailbox_id uuid references public.mailboxes (id) on delete set null;

alter table public.email_responses
  add column if not exists mailbox_id uuid references public.mailboxes (id) on delete set null;

-- The mailbox a sequence (or a scheduled send, which is a sequence) sends from.
-- Null = the org's common mailbox, as before.
alter table public.sequences
  add column if not exists mailbox_id uuid references public.mailboxes (id) on delete set null;

create index if not exists email_tracking_mailbox_idx
  on public.email_tracking (mailbox_id) where mailbox_id is not null;
create index if not exists email_responses_mailbox_idx
  on public.email_responses (mailbox_id) where mailbox_id is not null;

comment on column public.email_tracking.mailbox_id is
  'Individual mailbox the email was sent from (0084). Null = the org''s common mailbox.';
comment on column public.email_responses.mailbox_id is
  'Individual mailbox the reply arrived in (0084). Null = the org''s common mailbox.';
comment on column public.sequences.mailbox_id is
  'Individual mailbox this sequence sends from (0084). Null = the org''s common mailbox.';

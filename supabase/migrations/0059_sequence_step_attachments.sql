-- Files attached to a sequence email step.
--
-- Compose stages an attachment for minutes (draft-attachment-staging, 20-min
-- TTL) because the mail leaves as soon as you hit Send. A sequence step is the
-- opposite: written once, sent from cron days or weeks later, to each recipient
-- separately — so the bytes have to outlive the editing session. They live in
-- the private "sequence-attachments" storage bucket, and this table is the
-- index the runner reads to rebuild the MIME message at send time.
--
-- Rows hang off the step, not the sequence: reordering a step keeps its id (the
-- steps PUT updates in place), and deleting one should take its files with it.

create table if not exists public.sequence_step_attachments (
  id                uuid primary key default gen_random_uuid(),
  sequence_id       uuid not null references public.sequences (id) on delete cascade,
  step_id           uuid not null references public.sequence_steps (id) on delete cascade,
  mailbox_owner_id  uuid not null references auth.users (id) on delete cascade,
  storage_path      text not null,
  filename          text not null,
  mime_type         text not null,
  size_bytes        int not null,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

comment on table public.sequence_step_attachments is
  'Files attached to a sequence email step; storage_path points into the sequence-attachments bucket.';

create index if not exists sequence_step_attachments_step_idx
  on public.sequence_step_attachments (step_id);

alter table public.sequence_step_attachments enable row level security;

-- Same tenancy rule as the rest of the sequence tables: the mailbox the mail
-- physically leaves from. The API routes use the service role, so these
-- policies only matter for direct client reads.
drop policy if exists sequence_step_attachments_rw on public.sequence_step_attachments;
create policy sequence_step_attachments_rw on public.sequence_step_attachments
  for all
  using (mailbox_owner_id = public.current_mailbox_owner_id())
  with check (mailbox_owner_id = public.current_mailbox_owner_id());

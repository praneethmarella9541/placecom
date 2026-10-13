-- Scheduled sends: a one-off or mass email created from the composer's "Scheduling" toggle runs
-- on the same engine as a sequence (steps, waits, send window, exit on reply, cron). These columns
-- let the engine tell the two apart and cover what compose offers that a sequence did not.

alter table public.sequences
  -- 'sequence' = built in the sequence editor; 'scheduled' = created from the composer.
  add column if not exists origin text not null default 'sequence'
    check (origin in ('sequence', 'scheduled')),
  -- 'contacts' = merge fields are re-read from the contact book at send time (sequences' behaviour);
  -- 'stored' = the fields saved on each recipient are authoritative (an imported spreadsheet, whose
  -- columns must win over the contact book, as they do in an immediate mass send).
  add column if not exists merge_source text not null default 'contacts'
    check (merge_source in ('contacts', 'stored')),
  -- Gmail labels applied to every message this sequence sends (the composer's label picker).
  add column if not exists label_ids text[] not null default '{}',
  -- The start time the user picked, kept for display; the scheduler uses next_run_at.
  add column if not exists scheduled_for timestamptz;

comment on column public.sequences.origin is
  'sequence = created in the sequence editor; scheduled = created from the composer Scheduling toggle.';
comment on column public.sequences.merge_source is
  'contacts = resolve merge fields from the contact book at send time; stored = use fields saved on the enrollment.';

alter table public.sequence_enrollments
  add column if not exists bcc text;

comment on column public.sequence_enrollments.bcc is
  'Comma-separated Bcc recipients added to every step sent to this enrollment.';

-- Resume / partial-failure support for extraction jobs

alter table public.extraction_jobs
  drop constraint if exists extraction_jobs_status_check;

alter table public.extraction_jobs
  add constraint extraction_jobs_status_check check (
    status in ('pending', 'running', 'done', 'error', 'partial')
  );

alter table public.extraction_jobs
  add column if not exists next_batch_index int not null default 0,
  add column if not exists batch_count int not null default 0,
  add column if not exists error_message text,
  add column if not exists fetched_count int not null default 0,
  add column if not exists skipped_count int not null default 0,
  add column if not exists pending_emails jsonb;

comment on column public.extraction_jobs.pending_emails is
  'Emails awaiting extraction (for resume after partial failure or tab refresh).';

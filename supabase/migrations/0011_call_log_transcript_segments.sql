alter table public.call_logs
  add column if not exists transcript_segments jsonb;

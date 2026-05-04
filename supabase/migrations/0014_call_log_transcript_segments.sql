-- Renumbered from 0011 (see 0012_call_log_recordings.sql).
alter table public.call_logs
  add column if not exists transcript_segments jsonb;

-- Renumbered from 0010 (see 0012_call_log_recordings.sql).
alter table public.call_logs
  add column if not exists transcript text;

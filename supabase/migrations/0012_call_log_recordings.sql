-- Renumbered from 0009: parallel branch had CRM migrations 0009–0011; keep call_log alters after those.
alter table public.call_logs
  add column if not exists recording_sid text,
  add column if not exists recording_duration_seconds int;

create unique index if not exists call_logs_recording_sid_key
  on public.call_logs (recording_sid)
  where recording_sid is not null;

-- Talk time (answered portion only), separate from duration_seconds which may include ring time.
alter table public.call_logs
  add column if not exists conversation_duration_seconds int;

-- Adds an explicit 'paused' status, distinct from 'idle', so a user-initiated Stop
-- (app/api/directory-contacts/sync DELETE) can't be silently undone by the cron
-- job (app/api/cron/contact-sync) resuming it a few minutes later. 'idle' still
-- means "not currently running" for every other case (never started, or a batch
-- just finished) — cron only skips when the row is explicitly 'paused'.
--
-- Finds whatever check constraint is currently on the status column (its name
-- depends on how it was originally created) rather than assuming a specific
-- name, so this applies cleanly regardless.

do $$
declare
  con record;
begin
  for con in
    select conname
    from pg_constraint
    where conrelid = 'public.contact_sync_state'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.contact_sync_state drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.contact_sync_state
  add constraint contact_sync_state_status_check
  check (status in ('idle', 'running', 'paused', 'error'));

-- A wait step can now end at a chosen time instead of after a duration.
--
-- Scheduled sends let someone pick "Thu 23 Oct, 10:00 AM" for a follow-up rather than "3 business
-- days after the previous email". That is stored on the wait step as `send_at`; the delay columns
-- stay 0 for it. The sender (lib/sequence-schedule.ts: planNextEmailStep) holds the next email
-- until then, snapped into the sending window, and never sends it before the previous email has
-- gone out.
--
-- Run this BEFORE deploying the code that reads `send_at` — the step queries name the column.

alter table public.sequence_steps
  add column if not exists send_at timestamptz;

comment on column public.sequence_steps.send_at is
  'Wait steps only: hold the next email until this instant (then the sending window applies). When set, the delay_* columns are 0.';

alter table public.sequence_steps
  drop constraint if exists sequence_steps_wait_has_delay;

alter table public.sequence_steps
  add constraint sequence_steps_wait_has_delay
    check (
      kind <> 'wait'
      or (delay_days + delay_hours + delay_minutes) > 0
      or send_at is not null
    );

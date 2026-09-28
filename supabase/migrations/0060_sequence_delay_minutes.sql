-- Minute granularity on wait steps.
--
-- TESTING AID: days + hours is the real cadence unit for a follow-up sequence;
-- minutes exist so a sequence can be exercised end to end in a couple of minutes
-- instead of a couple of days. Safe to drop later — the column defaults to 0, so
-- removing it only requires reverting the wait-has-delay constraint below.
--
-- Note that a minute-level wait only behaves like one if the sequence's sending
-- window is wide open (00:00-23:59, business-days-only off); addDelay() snaps
-- every result into the window, so a 2-minute wait at 18:00 on a 9-5 sequence
-- still lands at 09:00 the next morning.

alter table public.sequence_steps
  add column if not exists delay_minutes int not null default 0;

alter table public.sequence_steps
  drop constraint if exists sequence_steps_delay_minutes_check;

alter table public.sequence_steps
  add constraint sequence_steps_delay_minutes_check
    check (delay_minutes between 0 and 59);

-- Widen "a wait step must actually wait" to count minutes.
alter table public.sequence_steps
  drop constraint if exists sequence_steps_wait_has_delay;

alter table public.sequence_steps
  add constraint sequence_steps_wait_has_delay
    check (kind <> 'wait' or (delay_days + delay_hours + delay_minutes) > 0);

comment on column public.sequence_steps.delay_minutes is
  'Minutes component of a wait step (0-59). Testing aid — see 0060 migration header.';

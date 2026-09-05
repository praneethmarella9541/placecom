-- Per-recipient CC for sequence emails. Nothing else on sequence_enrollments
-- carries a validated list of addresses, so this is stored as a plain
-- comma-separated string (same shape the enrollment API already accepts for
-- recipients) rather than a normalized table — one sequence step's worth of
-- extra recipients per enrollment, never queried on its own.

alter table public.sequence_enrollments
  add column if not exists cc text;

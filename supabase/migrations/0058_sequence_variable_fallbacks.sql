-- Per-sequence fallback values for merge variables.
--
-- Mass sending has the same idea in client state (variableFallbacks in the
-- compose flow): when a recipient has no value for {job_title}, a fallback
-- fills it rather than leaving a hole. A sequence sends from cron long after
-- the composer is closed, so the fallbacks have to live with the sequence
-- instead of in the page.
--
-- This is not cosmetic: sequence-runner treats an unfillable placeholder as a
-- reason to skip the recipient entirely and flag them "needs attention", so a
-- fallback is what turns a step that would skip half the list into one that
-- sends to all of it.
--
-- Shape: { "job_title": "there", "company_name": "your team" } — merge key
-- (already normalized to [a-z0-9_]) → the literal substituted for anyone with
-- no value of their own.

alter table public.sequences
  add column if not exists variable_fallbacks jsonb not null default '{}'::jsonb;

comment on column public.sequences.variable_fallbacks is
  'Merge key → value used for recipients whose own merge_fields have nothing for that key.';

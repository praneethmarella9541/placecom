-- Grouped name / email / phone per extraction row (heuristic pairing at ingest time).

alter table public.email_extractions
  add column if not exists extracted_contacts jsonb not null default '[]'::jsonb;

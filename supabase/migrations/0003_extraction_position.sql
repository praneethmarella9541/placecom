-- Add a position column to preserve Gmail ordering (newest = 0).
-- Nullable so existing rows don't break; new extractions always set it.

alter table public.email_extractions
  add column if not exists position int;

create index if not exists email_extractions_user_id_position_idx
  on public.email_extractions (user_id, job_id, position asc);

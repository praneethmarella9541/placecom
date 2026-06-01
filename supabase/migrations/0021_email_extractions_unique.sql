-- One row per Gmail message per user (re-runs update instead of duplicating).
DELETE FROM public.email_extractions a
USING public.email_extractions b
WHERE a.user_id = b.user_id
  AND a.email_id = b.email_id
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS email_extractions_user_id_email_id_key
  ON public.email_extractions (user_id, email_id);

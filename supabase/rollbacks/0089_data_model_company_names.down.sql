-- Undo 0089: drop the helper. Then re-run the data_model_backfill definition from 0087 to restore the old naming.
drop function if exists public.data_model_company_label(text);

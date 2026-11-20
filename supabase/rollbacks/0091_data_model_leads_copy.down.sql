-- Undo 0091: drop the function. Rows it already copied stay; to remove them, delete the Leads list
-- (cascades its entries) and the notes and people it created:
--   delete from public.data_lists where slug = 'leads';
--   delete from public.data_notes where legacy_source in ('lead_interactions', 'crm_contact_notes');
--   delete from public.data_records where legacy_source = 'leads';
drop function if exists public.data_model_backfill_leads(uuid, boolean);

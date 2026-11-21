-- Undo 0092: every object is open to staff again.
alter table public.data_objects drop column if exists staff_access;

-- Read-only checks for 0092. Run each block separately in the SQL editor.

-- 1. Every object starts open to staff. Expect only 'write'.
select staff_access, count(*) from public.data_objects group by 1;

-- 2. Anything hidden or read-only (set from the Fields dialog by an admin):
select org_owner_id, slug, staff_access from public.data_objects where staff_access <> 'write';

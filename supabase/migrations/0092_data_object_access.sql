-- Flexible data model: who on the team may use each object.
--
-- Admins always have full access. For everyone else (staff), an object has one setting:
--   write  read and change its records (the default, so nothing changes for anyone today)
--   read   look but not change
--   none   the object is hidden: it isn't listed and every call for it is refused
-- A staff member's mailbox access still applies on top (view-only mailbox access = read only),
-- as set in 0086's access rule. Lists follow the object they are built on.
--
-- This is workspace-wide per object. Per-team and per-member settings, and row rules, need the
-- workspace membership brief and are not here.
-- Undo with supabase/rollbacks/0092_data_object_access.down.sql.

alter table public.data_objects
  add column if not exists staff_access text not null default 'write'
  check (staff_access in ('none', 'read', 'write'));

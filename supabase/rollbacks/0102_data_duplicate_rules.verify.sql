-- Read-only checks for 0102. Run each block separately in the SQL editor.

-- 1. Every duplicate rule, its fields and its action.
select org_owner_id, object_id, name, fields, match_type, action, active from public.data_duplicate_rules;

-- 2. Rules with an action other than the default 'warn'.
select name, action from public.data_duplicate_rules where action <> 'warn';

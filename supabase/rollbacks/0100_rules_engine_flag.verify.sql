-- Read-only checks for 0100. Run each block separately in the SQL editor.

-- 1. The table exists and starts empty (every workspace defaults to the legacy rules path).
select count(*) from public.data_rules_feature_flags;

-- 2. Which workspaces (if any) have opted into the new formula engine.
select org_owner_id, formula_engine, updated_at from public.data_rules_feature_flags where formula_engine;

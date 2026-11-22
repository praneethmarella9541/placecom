-- Read-only checks for 0101. Run each block separately in the SQL editor.

-- 1. Every existing rule stayed 'legacy' with no formula columns populated.
select count(*) from public.data_validation_rules where format <> 'legacy' or expression_source is not null;

-- 2. Which rules (if any) are formula rules, and whether they compiled (expression_ast present).
select id, name, api_name, mode, applies_on, expression_source is not null as has_source, expression_ast is not null as has_ast
from public.data_validation_rules where format = 'formula';

-- 3. No duplicate api_name within an object.
select org_owner_id, object_id, api_name, count(*) from public.data_validation_rules
where api_name is not null group by 1,2,3 having count(*) > 1;

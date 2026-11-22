-- Undo 0101. Drops every column and index this migration added; every rule reverts to the 'legacy'
-- condition+requirements shape (0093), which is unaffected by this rollback.
drop index if exists public.data_validation_rules_order_idx;
drop index if exists public.data_validation_rules_api_name_idx;
alter table public.data_validation_rules drop constraint if exists data_validation_rules_formula_shape;
alter table public.data_validation_rules
  drop column if exists format,
  drop column if exists api_name,
  drop column if exists description,
  drop column if exists applies_on,
  drop column if exists mode,
  drop column if exists error_location,
  drop column if exists message,
  drop column if exists expression_source,
  drop column if exists expression_ast,
  drop column if exists builder_state,
  drop column if exists order_index,
  drop column if exists admin_bypass,
  drop column if exists version,
  drop column if exists updated_by,
  drop column if exists updated_at;

-- Undo 0103. Drops the audit log and version-history tables; no rule or record is touched.
drop table if exists public.data_validation_rule_versions;
drop table if exists public.data_rule_evaluation_log;

-- Read-only checks for 0103. Run each block separately in the SQL editor.

-- 1. The most recent audit-log entries, newest first.
select rule_id, object_id, record_id, outcome, message, actor_id, created_at
from public.data_rule_evaluation_log
order by created_at desc
limit 50;

-- 2. How many times each rule has blocked, warned, or been bypassed.
select rule_id, outcome, count(*) from public.data_rule_evaluation_log group by rule_id, outcome order by 1, 2;

-- 3. Every stored version snapshot for one rule (replace the uuid).
select version, snapshot, changed_by, created_at
from public.data_validation_rule_versions
where rule_id = '00000000-0000-0000-0000-000000000000'
order by version desc;

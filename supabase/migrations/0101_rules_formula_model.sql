-- Extends data_validation_rules (0093) so a rule can be a formula instead of the original
-- condition+requirements shape, without touching a single existing row: every new column is
-- nullable or defaulted so an old rule keeps meaning exactly what it always meant. `format`
-- discriminates the two: 'legacy' (the only kind before this migration) or 'formula'.
--
-- See lib/data-model/rule-formula-validate.ts for what's enforced on save, and
-- lib/data-model/rule-engine-bridge.ts for how a 'formula' rule is evaluated — it reuses the same
-- bridge phase 2 built for replaying 'legacy' rules through lib/rules-engine, so both formats run
-- through one evaluator once a workspace's flag (0100) is on. A 'formula' row is meaningless with
-- the flag off (nothing reads expression_source there), so the API refuses to create one unless the
-- workspace has already opted in — see the POST route.
--
-- Same access pattern as 0093: RLS on, no policies, service role only, every route scopes by org.
-- Undo with supabase/rollbacks/0101_rules_formula_model.down.sql.

alter table public.data_validation_rules
  add column if not exists format           text not null default 'legacy' check (format in ('legacy', 'formula')),
  add column if not exists api_name         text check (api_name is null or api_name ~ '^[a-z][a-z0-9_]{0,59}$'),
  add column if not exists description      text check (description is null or length(description) <= 2000),
  -- Record rules only: when a formula rule is checked. Irrelevant for a stage rule (entering the
  -- stage IS the condition, same as a legacy stage rule).
  add column if not exists applies_on       text not null default 'both' check (applies_on in ('create', 'update', 'both')),
  add column if not exists mode             text not null default 'block' check (mode in ('block', 'warn')),
  -- null = the error banner at the top of the form; otherwise an attribute slug.
  add column if not exists error_location   text,
  add column if not exists message          text check (message is null or length(message) <= 500),
  add column if not exists expression_source text check (expression_source is null or length(expression_source) <= 4000),
  add column if not exists expression_ast   jsonb,
  -- Reserved for the visual builder (not built this phase); nothing reads or writes it yet.
  add column if not exists builder_state    jsonb,
  add column if not exists order_index      integer not null default 0,
  add column if not exists admin_bypass     boolean not null default false,
  add column if not exists version          integer not null default 1,
  add column if not exists updated_by       uuid references auth.users (id) on delete set null,
  add column if not exists updated_at       timestamptz not null default now();

alter table public.data_validation_rules
  add constraint data_validation_rules_formula_shape check (
    (format = 'legacy' and expression_source is null and expression_ast is null) or
    (format = 'formula' and expression_source is not null and expression_ast is not null)
  );

-- api_name is unique per object when set at all; legacy rows (api_name null) never collide.
create unique index if not exists data_validation_rules_api_name_idx
  on public.data_validation_rules (org_owner_id, object_id, api_name)
  where api_name is not null;

create index if not exists data_validation_rules_order_idx
  on public.data_validation_rules (org_owner_id, object_id, order_index) where active;

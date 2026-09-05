-- 0055 re-scoped crm_stages/crm_settings onto user_id, but left the original
-- mailbox_owner_id column's NOT NULL in place on both tables:
--   - crm_stages.mailbox_owner_id was declared `not null` outright (0054).
--   - crm_settings.mailbox_owner_id was the `primary key` column (0054) —
--     0055 dropped that PK constraint in favor of one on user_id, but
--     dropping a primary key constraint does NOT clear the NOT NULL it
--     implicitly set on the column; that's a separate attribute.
--
-- App code (lib/crm-stages.ts, app/api/crm/stages/route.ts,
-- app/api/crm/settings/route.ts) has not written mailbox_owner_id since
-- 0055 — every insert since then has failed this leftover constraint.

alter table public.crm_stages
  alter column mailbox_owner_id drop not null;

alter table public.crm_settings
  alter column mailbox_owner_id drop not null;

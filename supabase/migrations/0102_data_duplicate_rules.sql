-- Duplicate detection (not merge — see lib/data-model/duplicates.ts and docs/rules-engine's phase 5
-- notes): a matching rule names the fields that, together, identify the same real person or company
-- ("Traveller + Start date + Destination", say). 'exact' compares values as stored; 'normalized'
-- compares case-insensitively (the platform already trims text at save time, so that's the only
-- normalisation a stored value still needs). `action` decides what a match does to a save: 'block'
-- refuses it, 'warn' lets it through with the match surfaced on the form, 'report_only' lets it
-- through silently (detection for later review, never interrupts anyone).
--
-- Checked by createRecord/updateRecord (lib/data-model/records.ts) — the same choke point every
-- other check in this engine already goes through — so CSV import and workflow actions get this for
-- free, same as validation rules did in phase 2.
--
-- Same access pattern as 0093: RLS on, no policies, service role only, every route scopes by org.
-- Undo with supabase/rollbacks/0102_data_duplicate_rules.down.sql.

create table if not exists public.data_duplicate_rules (
  id            uuid primary key default gen_random_uuid(),
  org_owner_id  uuid not null references auth.users (id) on delete cascade,
  object_id     uuid not null,
  name          text not null check (length(btrim(name)) > 0 and length(name) <= 100),
  -- Attribute slugs, or "name" for the record's own name. All must match for the rule to fire.
  fields        text[] not null check (array_length(fields, 1) between 1 and 10),
  match_type    text not null default 'normalized' check (match_type in ('exact', 'normalized')),
  action        text not null default 'warn' check (action in ('block', 'warn', 'report_only')),
  active        boolean not null default true,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (object_id, org_owner_id) references public.data_objects (id, org_owner_id) on delete cascade
);
create index if not exists data_duplicate_rules_object_idx on public.data_duplicate_rules (org_owner_id, object_id) where active;

alter table public.data_duplicate_rules enable row level security;

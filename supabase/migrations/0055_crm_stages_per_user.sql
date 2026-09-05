-- Re-scopes the CRM board from "one shared board per admin team"
-- (mailbox_owner_id, migration 0054) to "one personal board per signed-in
-- user" — a staff member's kanban columns, season cutoff, and classifier
-- settings are now theirs alone, not shared with the rest of their team.
-- Leads themselves are untouched here: the underlying `leads` table keeps
-- its existing team-shared visibility (0048) for other consumers (the
-- Contacts directory's Status column) — only the CRM feature's own queries
-- (app/api/crm/*) now explicitly filter to the caller's own leads, in code,
-- not via a schema change.
--
-- ai_usage_events is deliberately NOT touched: cost visibility is a
-- different concern than board ownership, and an admin reasonably still
-- wants to see the whole team's AI spend even once boards are personal.

-- ---------------------------------------------------------------------------
-- crm_stages
-- ---------------------------------------------------------------------------

alter table public.crm_stages
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

-- Best-effort backfill: the existing shared board's rows become the
-- ADMIN's personal board (mailbox_owner_id was always the admin's own id).
-- Every other team member starts fresh — lib/crm-stages.ts seeds a new
-- default set for them the first time they open /crm after this runs.
update public.crm_stages
set user_id = mailbox_owner_id
where user_id is null;

alter table public.crm_stages
  alter column user_id set not null;

drop index if exists crm_stages_owner_position_idx;
drop index if exists crm_stages_owner_name_key;
drop index if exists crm_stages_owner_one_unsorted_key;

create index if not exists crm_stages_user_position_idx
  on public.crm_stages (user_id, position);

create unique index if not exists crm_stages_user_name_key
  on public.crm_stages (user_id, lower(btrim(name)));

create unique index if not exists crm_stages_user_one_unsorted_key
  on public.crm_stages (user_id) where is_unsorted;

drop policy if exists crm_stages_select_team on public.crm_stages;
drop policy if exists crm_stages_insert_team on public.crm_stages;
drop policy if exists crm_stages_update_team on public.crm_stages;
drop policy if exists crm_stages_delete_team on public.crm_stages;

create policy crm_stages_select_own on public.crm_stages
  for select to authenticated using (user_id = auth.uid());

create policy crm_stages_insert_own on public.crm_stages
  for insert to authenticated with check (user_id = auth.uid());

create policy crm_stages_update_own on public.crm_stages
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy crm_stages_delete_own on public.crm_stages
  for delete to authenticated using (user_id = auth.uid());

comment on column public.crm_stages.mailbox_owner_id is
  'Superseded by user_id (0055) — boards are personal now, not team-shared. Left in place, unused, rather than dropped.';

-- ---------------------------------------------------------------------------
-- crm_settings — mailbox_owner_id was the primary key; user_id replaces it.
-- Safe to re-key directly: 0054 allowed exactly one row per team, so this
-- backfill can never produce two rows colliding on the same user_id.
-- ---------------------------------------------------------------------------

alter table public.crm_settings
  add column if not exists user_id uuid references auth.users (id) on delete cascade;

update public.crm_settings
set user_id = mailbox_owner_id
where user_id is null;

alter table public.crm_settings
  alter column user_id set not null;

alter table public.crm_settings drop constraint if exists crm_settings_pkey;
alter table public.crm_settings add primary key (user_id);

drop policy if exists crm_settings_select_team on public.crm_settings;
drop policy if exists crm_settings_insert_team on public.crm_settings;
drop policy if exists crm_settings_update_team on public.crm_settings;

create policy crm_settings_select_own on public.crm_settings
  for select to authenticated using (user_id = auth.uid());

create policy crm_settings_insert_own on public.crm_settings
  for insert to authenticated with check (user_id = auth.uid());

create policy crm_settings_update_own on public.crm_settings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on column public.crm_settings.mailbox_owner_id is
  'Superseded by user_id (0055) — settings are personal now, not team-shared. Left in place, unused, rather than dropped.';

-- ---------------------------------------------------------------------------
-- leads — no schema change, just a data-consistency repair. A lead's
-- stage_id may now point at a crm_stages row that belongs to a *different*
-- user than the lead itself (e.g. a staff member's lead that was classified
-- onto the old shared board, which the backfill above just handed to the
-- admin alone). Left as-is, that lead would silently vanish from every
-- board — its stage_id doesn't match any column the lead's own owner can
-- now see, but also doesn't match none, so the app never falls back to
-- "unsorted". Clearing it back to null. is honest: whoever owns the lead
-- will see it land in Unsorted (once their own board is seeded) instead of
-- somewhere on a board they can never open, and it stays visible/reachable
-- rather than orphaned.
-- ---------------------------------------------------------------------------

update public.leads l
set stage_id = null,
    stage_set_by = 'human',
    updated_at = now()
where l.stage_id is not null
  and not exists (
    select 1 from public.crm_stages cs
    where cs.id = l.stage_id and cs.user_id = l.user_id
  );

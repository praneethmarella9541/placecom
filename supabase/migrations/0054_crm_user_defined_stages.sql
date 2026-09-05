-- Rebuilds the CRM board around *user-defined* stages plus LLM classification,
-- replacing the two hardcoded funnels that lived in the `lead_stage` enum
-- (0009/0010: Awareness/Engagement/Conversion/Retention and Relationship Mgt/
-- JD Expected/JD Received/Drive Scheduled).
--
-- The enum and `leads.stage` are deliberately LEFT IN PLACE, not dropped:
-- lib/lead-contact-match.ts feeds the Contacts directory's Status column from
-- `stage`/`score`, so removing it would break a page that has nothing to do
-- with this rebuild. New code reads `leads.stage_id`; `stage` keeps being
-- written as a coarse legacy mirror until Contacts is migrated off it.
--
-- Scoping model follows 0047/0048: stages and settings are *team* config keyed
-- on mailbox_owner_id (one board per admin team — staff must not each invent
-- their own columns), resolved via public.current_mailbox_owner_id(). Leads
-- themselves keep their existing own-row-or-team RLS, untouched here.

-- ---------------------------------------------------------------------------
-- crm_stages — the kanban columns, defined by the user rather than an enum.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_stages (
  id               uuid primary key default gen_random_uuid(),
  mailbox_owner_id uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  -- Free-text "what belongs in this column". Doubles as the classifier's
  -- definition of the category (see lib/crm-classify.ts) — naming a column is
  -- how the user writes the prompt, so this is intentionally prose, not a slug.
  description      text,
  position         integer not null default 0,
  color            text,
  -- Exactly one stage per team is the holding pen for leads the model could
  -- not place confidently. Never auto-assigned away from; enforced below.
  is_unsorted      boolean not null default false,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint crm_stages_name_not_blank check (length(btrim(name)) > 0)
);

comment on table public.crm_stages is
  'User-defined kanban columns, one set per admin team (mailbox_owner_id). description is also the category definition handed to the classifier.';

create index if not exists crm_stages_owner_position_idx
  on public.crm_stages (mailbox_owner_id, position);

-- One column name per board, and at most one "unsorted" holding column.
create unique index if not exists crm_stages_owner_name_key
  on public.crm_stages (mailbox_owner_id, lower(btrim(name)));

create unique index if not exists crm_stages_owner_one_unsorted_key
  on public.crm_stages (mailbox_owner_id) where is_unsorted;

alter table public.crm_stages enable row level security;

drop policy if exists crm_stages_select_team on public.crm_stages;
drop policy if exists crm_stages_insert_team on public.crm_stages;
drop policy if exists crm_stages_update_team on public.crm_stages;
drop policy if exists crm_stages_delete_team on public.crm_stages;

create policy crm_stages_select_team on public.crm_stages
  for select to authenticated
  using (mailbox_owner_id = public.current_mailbox_owner_id());

create policy crm_stages_insert_team on public.crm_stages
  for insert to authenticated
  with check (mailbox_owner_id = public.current_mailbox_owner_id());

create policy crm_stages_update_team on public.crm_stages
  for update to authenticated
  using (mailbox_owner_id = public.current_mailbox_owner_id())
  with check (mailbox_owner_id = public.current_mailbox_owner_id());

create policy crm_stages_delete_team on public.crm_stages
  for delete to authenticated
  using (mailbox_owner_id = public.current_mailbox_owner_id());

-- ---------------------------------------------------------------------------
-- crm_settings — per-team classifier config, one row per board.
-- ---------------------------------------------------------------------------

create table if not exists public.crm_settings (
  mailbox_owner_id     uuid primary key references auth.users (id) on delete cascade,
  -- The user-supplied cutoff: only mail/WhatsApp on or after this date is fed
  -- to the classifier, so a lead is judged on this season rather than history.
  season_start_date    date,
  model                text not null default 'gpt-5-nano',
  -- Below this the lead lands in the is_unsorted stage instead of being placed.
  confidence_threshold numeric(3,2) not null default 0.60,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint crm_settings_threshold_range
    check (confidence_threshold >= 0 and confidence_threshold <= 1)
);

comment on table public.crm_settings is
  'Per-team CRM classifier config — season cutoff date, OpenAI model, confidence threshold.';

alter table public.crm_settings enable row level security;

drop policy if exists crm_settings_select_team on public.crm_settings;
drop policy if exists crm_settings_insert_team on public.crm_settings;
drop policy if exists crm_settings_update_team on public.crm_settings;

create policy crm_settings_select_team on public.crm_settings
  for select to authenticated
  using (mailbox_owner_id = public.current_mailbox_owner_id());

create policy crm_settings_insert_team on public.crm_settings
  for insert to authenticated
  with check (mailbox_owner_id = public.current_mailbox_owner_id());

create policy crm_settings_update_team on public.crm_settings
  for update to authenticated
  using (mailbox_owner_id = public.current_mailbox_owner_id())
  with check (mailbox_owner_id = public.current_mailbox_owner_id());

-- ---------------------------------------------------------------------------
-- leads — board placement + classifier provenance.
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists stage_id         uuid references public.crm_stages (id) on delete set null,
  -- 'human' once someone drags the card: re-classification then leaves it
  -- alone rather than silently undoing a deliberate decision.
  add column if not exists stage_set_by     text not null default 'human',
  add column if not exists ai_confidence    numeric(3,2),
  add column if not exists ai_rationale     text,
  add column if not exists ai_classified_at timestamptz,
  -- Which contact-book row this lead was added from, so the same contact isn't
  -- imported twice and the card can link back.
  add column if not exists source_contact_id uuid references public.directory_contacts (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leads_stage_set_by_check'
  ) then
    alter table public.leads
      add constraint leads_stage_set_by_check check (stage_set_by in ('human', 'ai'));
  end if;
end $$;

create index if not exists leads_stage_id_idx on public.leads (stage_id);
create index if not exists leads_source_contact_idx on public.leads (source_contact_id);

comment on column public.leads.stage_id is
  'Current user-defined board column (crm_stages). Supersedes the legacy `stage` enum, which is still written for lib/lead-contact-match.ts.';
comment on column public.leads.stage_set_by is
  'human = someone placed this card by hand; ai = classifier placed it. Re-classification skips human-set cards.';

-- ---------------------------------------------------------------------------
-- ai_usage_events — the AI cost ledger.
--
-- Deliberately generic (feature/ref_id rather than lead_id): extraction and
-- call transcription already burn OpenAI tokens and only record cost on
-- extraction_jobs (0005), so there is no single place to answer "what did AI
-- cost us this month". New spend lands here; the older paths can be folded in
-- later without another schema change.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_usage_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users (id) on delete set null,
  mailbox_owner_id uuid references auth.users (id) on delete set null,
  feature          text not null,
  model            text not null,
  input_tokens     bigint not null default 0,
  output_tokens    bigint not null default 0,
  -- Priced at call time via lib/openai-pricing.ts, so a later price change
  -- doesn't silently rewrite history.
  cost_usd         numeric(14,6) not null default 0,
  -- Free-form pointer to whatever the call was about (a lead id, a job id).
  ref_id           text,
  created_at       timestamptz not null default now()
);

comment on table public.ai_usage_events is
  'Append-only ledger of OpenAI spend, priced at call time. feature/ref_id keep it usable beyond the CRM.';

create index if not exists ai_usage_events_owner_created_idx
  on public.ai_usage_events (mailbox_owner_id, created_at desc);
create index if not exists ai_usage_events_feature_created_idx
  on public.ai_usage_events (feature, created_at desc);

alter table public.ai_usage_events enable row level security;

drop policy if exists ai_usage_events_select_scoped on public.ai_usage_events;

-- Read-only to clients: rows are written server-side with the service role, so
-- there is no insert/update/delete policy here on purpose — a user must not be
-- able to forge or erase their own spend.
create policy ai_usage_events_select_scoped on public.ai_usage_events
  for select to authenticated using (
    user_id = auth.uid()
    or (mailbox_owner_id = auth.uid() and public.current_mailbox_owner_id() = auth.uid())
  );

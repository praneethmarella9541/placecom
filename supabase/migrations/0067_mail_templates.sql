-- Reusable email templates for the compose window and sequence steps.
--
-- A template is the two strings compose already holds — a subject and a body —
-- saved under a name so they can be pulled back into a draft later. The
-- `{variable}` syntax inside them is the same one lib/mail-merge.ts already
-- substitutes, so a template written here works unchanged in a single send, a
-- mass campaign, and a sequence step. Nothing about substitution lives here.
--
-- Personal, not team-shared: one person's half-finished outreach wording is not
-- something their teammates should find in their own picker, and a shared
-- library invites one member editing the template another is mid-send with.
-- Same call 0055 made for CRM boards and 0050 for connection-strength
-- thresholds. Sharing, if it is ever wanted, is an added visibility column and
-- a widened policy — not a rewrite of this table.
--
-- Deliberately no attachments column. Compose stages attachment bytes for 20
-- minutes (draft-attachment-staging) because the mail leaves immediately; a
-- template outlives that by design, so template attachments would need their
-- own durable bucket the way sequence_step_attachments (0059) has one. Out of
-- scope until someone asks.

create table if not exists public.mail_templates (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  -- Both nullable-as-empty rather than null: a reply template legitimately has
  -- no subject of its own, and an empty string is what the composer hands over.
  subject_template  text not null default '',
  body_html         text not null default '',
  -- Touched on every insert into a draft, so the picker can lead with what this
  -- person actually reaches for instead of whatever they saved most recently.
  last_used_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint mail_templates_name_not_blank check (btrim(name) <> '')
);

comment on table public.mail_templates is
  'Per-user saved email templates (subject + body HTML) inserted from the compose window and sequence step editor.';

-- The picker's only read: this user's templates, most recently used first.
create index if not exists mail_templates_user_recent_idx
  on public.mail_templates (user_id, last_used_at desc nulls last, updated_at desc);

-- Two templates called the same thing are indistinguishable in a dropdown, so
-- the name is unique per user — case- and whitespace-insensitively, since
-- "Recruiter intro" and "recruiter intro " are the same name to a reader.
create unique index if not exists mail_templates_user_name_key
  on public.mail_templates (user_id, lower(btrim(name)));

alter table public.mail_templates enable row level security;

-- Writes go through /api/mail-templates with the service role, so these
-- policies only bind direct client reads — but they are the backstop that keeps
-- one user's templates out of another's hands if a client ever queries
-- directly. `(select auth.uid())` rather than a bare call so Postgres evaluates
-- it once per query instead of once per row (see 0061).
drop policy if exists mail_templates_select_own on public.mail_templates;
drop policy if exists mail_templates_insert_own on public.mail_templates;
drop policy if exists mail_templates_update_own on public.mail_templates;
drop policy if exists mail_templates_delete_own on public.mail_templates;

create policy mail_templates_select_own on public.mail_templates
  for select to authenticated using (user_id = (select auth.uid()));

create policy mail_templates_insert_own on public.mail_templates
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy mail_templates_update_own on public.mail_templates
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy mail_templates_delete_own on public.mail_templates
  for delete to authenticated using (user_id = (select auth.uid()));

-- Files attached to a saved mail template.
--
-- 0067 left attachments out because compose only stages bytes for 20 minutes
-- (draft-attachment-staging) and a template outlives that by design. Same
-- answer sequence steps got in 0059: a private "mail-template-attachments"
-- storage bucket holds the bytes, and this table is the index.
--
-- Using a template copies its files into the draft (compose staging) or the
-- sequence step (sequence-attachments). Nothing ever sends straight from this
-- bucket, so editing or deleting a template can never change a mail that has
-- already picked it up.
--
-- Stored files are capped at Gmail's 25 MB per template in total — enforced by
-- the API routes, which check the declared size before upload and the stored
-- size after. A file that doesn't fit goes to Google Drive instead and is kept
-- here as a link, the way compose (and Gmail) handle oversized attachments:
-- such a row has drive_file_id / web_view_link and no storage_path.

create table if not exists public.mail_template_attachments (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.mail_templates (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- Exactly one of storage_path (bytes in the bucket) or drive_file_id (a
  -- shared Drive link) is set.
  storage_path  text,
  drive_file_id text,
  web_view_link text,
  filename      text not null,
  mime_type     text not null,
  -- bigint: a Drive-linked file is not bound by Gmail's limit.
  size_bytes    bigint not null check (size_bytes >= 0),
  created_at    timestamptz not null default now()
);

-- Safe to re-run over an earlier copy of this migration that predates Drive links.
alter table public.mail_template_attachments add column if not exists drive_file_id text;
alter table public.mail_template_attachments add column if not exists web_view_link text;
alter table public.mail_template_attachments alter column storage_path drop not null;
alter table public.mail_template_attachments alter column size_bytes type bigint;
alter table public.mail_template_attachments
  drop constraint if exists mail_template_attachments_one_source;
alter table public.mail_template_attachments
  add constraint mail_template_attachments_one_source
  check ((storage_path is not null) <> (drive_file_id is not null));

comment on table public.mail_template_attachments is
  'Files attached to a mail template: bytes in the mail-template-attachments bucket (storage_path), or a shared Google Drive link (drive_file_id) for files over Gmail''s limit.';

create index if not exists mail_template_attachments_template_idx
  on public.mail_template_attachments (template_id, created_at);

alter table public.mail_template_attachments enable row level security;

-- Personal, like the templates themselves (see 0067). Reads go through the
-- caller's session client, so these policies are what enforce ownership.
drop policy if exists mail_template_attachments_select_own on public.mail_template_attachments;
drop policy if exists mail_template_attachments_insert_own on public.mail_template_attachments;
drop policy if exists mail_template_attachments_delete_own on public.mail_template_attachments;

create policy mail_template_attachments_select_own on public.mail_template_attachments
  for select to authenticated using (user_id = (select auth.uid()));

create policy mail_template_attachments_insert_own on public.mail_template_attachments
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy mail_template_attachments_delete_own on public.mail_template_attachments
  for delete to authenticated using (user_id = (select auth.uid()));

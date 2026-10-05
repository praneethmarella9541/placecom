-- Sequence step attachments follow the same rule as compose and mail templates.
--
-- 0059 capped a step at 10 MB per file, 10 files and 18 MB in total, and
-- refused anything past that. The rule is now shared (lib/gmail-draft-limits,
-- sendsAsDriveLink): a file up to Gmail's 25 MB is attached, a bigger one is
-- uploaded to Google Drive, shared "anyone with the link can view", and sent as
-- a link in the body. No total or count cap.
--
-- A Drive-linked row has drive_file_id / web_view_link and no storage_path;
-- the runner appends those links to the mail the way compose does.

alter table public.sequence_step_attachments add column if not exists drive_file_id text;
alter table public.sequence_step_attachments add column if not exists web_view_link text;
alter table public.sequence_step_attachments alter column storage_path drop not null;
-- A Drive-linked file is not bound by Gmail's limit, so it can outgrow an int.
alter table public.sequence_step_attachments alter column size_bytes type bigint;

alter table public.sequence_step_attachments
  drop constraint if exists sequence_step_attachments_one_source;
alter table public.sequence_step_attachments
  add constraint sequence_step_attachments_one_source
  check ((storage_path is not null) <> (drive_file_id is not null));

comment on table public.sequence_step_attachments is
  'Files attached to a sequence email step: bytes in the sequence-attachments bucket (storage_path), or a shared Google Drive link (drive_file_id) for files over Gmail''s 25 MB.';

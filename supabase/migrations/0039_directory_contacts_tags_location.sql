-- Adds Location + Tags to the shared contact directory (contact-detail redesign).
-- `title` already exists and is displayed as "Designation" in the UI — no column needed for that.

alter table public.directory_contacts
  add column if not exists location text,
  add column if not exists tags text[] not null default '{}';

create index if not exists directory_contacts_tags_idx on public.directory_contacts using gin (tags);

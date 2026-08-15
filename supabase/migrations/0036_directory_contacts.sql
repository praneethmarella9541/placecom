-- Shared, org-wide contact directory: one address book every signed-in user can
-- read and maintain (name, company, title, email, phone, LinkedIn, notes).
-- Unlike wa_contacts/leads (per-user), this is a team-shared table — same
-- trust model as whatsapp_messages: any authenticated user can read/write.

create table if not exists public.directory_contacts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  company      text,
  title        text,
  email        text,
  phone        text,
  linkedin_url text,
  notes        text,
  created_by   uuid references auth.users (id) on delete set null,
  updated_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.directory_contacts is
  'Org-wide contact directory shared across all users/admins — not per-user like wa_contacts.';

alter table public.directory_contacts enable row level security;

drop policy if exists directory_contacts_select_authenticated on public.directory_contacts;
drop policy if exists directory_contacts_insert_authenticated on public.directory_contacts;
drop policy if exists directory_contacts_update_authenticated on public.directory_contacts;
drop policy if exists directory_contacts_delete_authenticated on public.directory_contacts;

create policy directory_contacts_select_authenticated on public.directory_contacts
  for select to authenticated using (true);

create policy directory_contacts_insert_authenticated on public.directory_contacts
  for insert to authenticated with check (auth.uid() = created_by);

create policy directory_contacts_update_authenticated on public.directory_contacts
  for update to authenticated using (true) with check (true);

create policy directory_contacts_delete_authenticated on public.directory_contacts
  for delete to authenticated using (true);

create index if not exists directory_contacts_name_idx on public.directory_contacts (lower(name));

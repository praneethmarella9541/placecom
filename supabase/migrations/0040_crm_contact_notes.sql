-- Notes on a shared directory contact — org-wide visible (matches directory_contacts'
-- own RLS model), unlike the per-user lead_interactions table.

create table if not exists public.crm_contact_notes (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references public.directory_contacts (id) on delete cascade,
  kind        text not null default 'note' check (kind in ('note', 'call')),
  body        text not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on column public.crm_contact_notes.kind is
  'note = free-form note; call = quick-logged call from the Quick Interaction Logger (no live dialer).';

alter table public.crm_contact_notes enable row level security;

drop policy if exists crm_contact_notes_select_authenticated on public.crm_contact_notes;
drop policy if exists crm_contact_notes_insert_authenticated on public.crm_contact_notes;

create policy crm_contact_notes_select_authenticated on public.crm_contact_notes
  for select to authenticated using (true);

create policy crm_contact_notes_insert_authenticated on public.crm_contact_notes
  for insert to authenticated with check (auth.uid() = created_by);

create index if not exists crm_contact_notes_contact_id_idx on public.crm_contact_notes (contact_id, created_at desc);

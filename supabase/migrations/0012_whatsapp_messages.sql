-- Store WhatsApp session messages for in-app inbox (Twilio webhook + outbound sends)

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  peer_e164 text not null,
  from_addr text not null,
  to_addr text not null,
  body text,
  message_sid text unique,
  num_media int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_messages_peer_created_idx on public.whatsapp_messages (peer_e164, created_at desc);
create index if not exists whatsapp_messages_created_idx on public.whatsapp_messages (created_at desc);

alter table public.whatsapp_messages enable row level security;

create policy whatsapp_messages_select_authenticated on public.whatsapp_messages
  for select to authenticated using (true);

create policy whatsapp_messages_insert_own_outbound on public.whatsapp_messages
  for insert to authenticated with check (
    direction = 'outbound' and user_id = auth.uid()
  );

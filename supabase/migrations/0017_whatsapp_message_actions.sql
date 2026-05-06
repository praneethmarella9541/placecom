-- Reply link, star, pin, soft-delete for WhatsApp messages UI

alter table public.whatsapp_messages add column if not exists reply_to_id uuid references public.whatsapp_messages (id) on delete set null;
alter table public.whatsapp_messages add column if not exists is_starred boolean not null default false;
alter table public.whatsapp_messages add column if not exists is_pinned boolean not null default false;
alter table public.whatsapp_messages add column if not exists deleted_at timestamptz null;

create index if not exists whatsapp_messages_peer_pinned_idx on public.whatsapp_messages (peer_e164) where is_pinned = true and deleted_at is null;

create policy whatsapp_messages_update_authenticated on public.whatsapp_messages
  for update to authenticated using (true) with check (true);

-- Scope WhatsApp threads per business (Exotel) line — matches profiles.exotel_virtual_number.

alter table public.whatsapp_messages
  add column if not exists business_e164 text,
  add column if not exists delivery_status text;

comment on column public.whatsapp_messages.business_e164 is
  'Exotel WhatsApp business number (E.164) this message belongs to; used to isolate chats per team member.';
comment on column public.whatsapp_messages.delivery_status is
  'Exotel delivery state: sent, delivered, read, failed (outbound updates via webhook).';

create index if not exists whatsapp_messages_business_peer_created_idx
  on public.whatsapp_messages (business_e164, peer_e164, created_at desc)
  where deleted_at is null;

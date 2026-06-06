-- Move SMS to Exotel and scope threads per business (Exotel) line.
-- business_e164 matches profiles.exotel_virtual_number, so each team member
-- only sees the SMS threads on the number the admin assigned them (same model
-- as whatsapp_messages, migration 0024). delivery_status tracks Exotel DLRs.

alter table public.sms_messages
  add column if not exists business_e164 text,
  add column if not exists delivery_status text;

comment on column public.sms_messages.business_e164 is
  'Exotel ExoPhone (E.164) this SMS belongs to; isolates threads per team member.';
comment on column public.sms_messages.delivery_status is
  'Exotel SMS delivery state: queued, sent, delivered, failed, failed-dnd (outbound updates via status callback).';

create index if not exists sms_messages_business_peer_created_idx
  on public.sms_messages (business_e164, peer_e164, created_at desc);

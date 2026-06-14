-- Original attachment filename for WhatsApp media (separate from body caption).
alter table public.whatsapp_messages
  add column if not exists media_filename text null;

comment on column public.whatsapp_messages.media_filename is
  'Original filename for outbound/inbound media attachments (e.g. invoice.pdf).';

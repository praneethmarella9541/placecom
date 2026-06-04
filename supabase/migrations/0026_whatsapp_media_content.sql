-- Rich WhatsApp message metadata (media URL, content type for UI).

alter table public.whatsapp_messages
  add column if not exists media_url text,
  add column if not exists content_type text;

comment on column public.whatsapp_messages.media_url is
  'Public HTTPS URL for outbound/inbound media when available.';
comment on column public.whatsapp_messages.content_type is
  'Exotel message type: text, template, image, video, document, audio, location, interactive.';

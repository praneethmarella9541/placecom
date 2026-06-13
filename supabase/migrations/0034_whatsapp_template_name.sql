-- Store Meta template name on WhatsApp log rows for billing analytics.
alter table public.whatsapp_messages
  add column if not exists template_name text;

comment on column public.whatsapp_messages.template_name is
  'Meta template name when content_type is template; used for utility vs promotional billing.';

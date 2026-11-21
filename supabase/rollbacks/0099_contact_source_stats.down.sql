alter table public.synced_contact_sources
  drop column if exists message_count_90d,
  drop column if exists recent_message_dates,
  drop column if exists has_outbound_contact,
  drop column if exists has_direct_contact;

-- Per-team-member Exotel DID and personal mobile for call routing.
-- Admin assigns both via Team management; incoming calls to a DID forward to mobile_phone.

alter table public.profiles
  add column if not exists mobile_phone text,
  add column if not exists exotel_virtual_number text;

comment on column public.profiles.mobile_phone is
  'E.164 personal mobile; Exotel connect forwards inbound calls on exotel_virtual_number here.';
comment on column public.profiles.exotel_virtual_number is
  'Assigned Exotel virtual number (DID) this member dials for outbound and receives inbound on.';

create index if not exists profiles_exotel_virtual_number_idx
  on public.profiles (exotel_virtual_number)
  where exotel_virtual_number is not null;

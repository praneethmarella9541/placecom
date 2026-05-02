alter table public.meeting_recordings
  add column summary text,
  add column attendee_email text;

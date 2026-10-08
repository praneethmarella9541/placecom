-- One row per reply a recipient sent back to the team — every message, not a
-- yes/no flag per email. Admin analytics counts these as "Responded": three
-- replies are three, whatever conversation they are in.
--
-- email_tracking.replied (0063) and sequence_enrollments.status = 'replied'
-- only say *whether* an email was answered, so they can't count repeat replies.
-- Rows here are written when the app reads a conversation anyway: an inbox
-- thread being opened or hover-prefetched (lib/tracking-passive-sync.ts) and the
-- sequence runner's reply check before each step (lib/sequence-runner.ts).
-- gmail_message_id is unique, so seeing the same reply again never adds a row.

create table if not exists public.email_responses (
  id                uuid primary key default gen_random_uuid(),
  -- Gmail message id of the reply. Backfilled rows use a synthetic
  -- 'legacy:…' key, since the old flags never stored which message it was.
  gmail_message_id  text not null unique,
  gmail_thread_id   text,
  -- The team member the reply is credited to: whoever sent the last email in
  -- that conversation before the reply arrived (for a sequence, the member who
  -- enrolled the recipient).
  user_id           uuid not null references auth.users (id) on delete cascade,
  from_address      text,
  received_at       timestamptz not null,
  source            text not null check (source in ('inbox', 'sequence', 'legacy')),
  created_at        timestamptz not null default now()
);

comment on table public.email_responses is
  'Every reply received from a recipient, credited to a team member. Counted as "Responded" in admin analytics.';

create index if not exists email_responses_user_received_idx
  on public.email_responses (user_id, received_at);

alter table public.email_responses enable row level security;

-- Written and read by the service role (analytics, sync, cron). A member may
-- read their own rows; nobody writes through the client.
drop policy if exists email_responses_select_own on public.email_responses;
create policy email_responses_select_own on public.email_responses
  for select to authenticated using (auth.uid() = user_id);

-- The recorder looks up our emails in a conversation by its thread id every
-- time an inbox thread is opened; neither table had an index on it.
create index if not exists email_tracking_thread_idx
  on public.email_tracking (gmail_thread_id)
  where gmail_thread_id is not null;
create index if not exists sequence_sends_thread_idx
  on public.sequence_sends (gmail_thread_id)
  where gmail_thread_id is not null;

-- ─── Backfill ──────────────────────────────────────────────────────────────
-- What was already known: one reply per answered email. That's a floor (repeat
-- replies were never recorded), but it keeps past ranges from dropping to zero.

insert into public.email_responses (gmail_message_id, gmail_thread_id, user_id, received_at, source)
select 'legacy:' || t.id, t.gmail_thread_id, t.user_id, coalesce(t.replied_at, t.sent_at), 'legacy'
from public.email_tracking t
where t.replied = true
on conflict (gmail_message_id) do nothing;

insert into public.email_responses (gmail_message_id, gmail_thread_id, user_id, received_at, source)
select 'legacy-sequence:' || e.id,
       e.gmail_thread_id,
       coalesce(e.enrolled_by, s.created_by, e.mailbox_owner_id),
       coalesce(e.replied_at, e.last_sent_at, e.updated_at),
       'legacy'
from public.sequence_enrollments e
join public.sequences s on s.id = e.sequence_id
where e.status = 'replied'
on conflict (gmail_message_id) do nothing;

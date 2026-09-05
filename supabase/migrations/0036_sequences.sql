-- Automated email sequences: ordered email/wait steps, per-recipient enrollments,
-- and a cron-driven scheduler. Scoped to a shared mailbox, not an individual user,
-- because the mail physically leaves google_mailbox_credentials.owner_user_id.

-- ─── Tenancy helper ────────────────────────────────────────────────────────
-- Mirrors resolveMailboxGoogleAccessTokenUncached() in lib/mailbox-google-access.ts:
-- admins own their own mailbox, staff/committee inherit profiles.mailbox_owner_id.
-- KEEP THESE TWO IN SYNC — if they diverge, a user can see sequences whose mail
-- they are not able to send.
create or replace function public.current_mailbox_owner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when p.role = 'admin' then p.id else p.mailbox_owner_id end
  from public.profiles p
  where p.id = auth.uid()
$$;

comment on function public.current_mailbox_owner_id() is
  'Mailbox tenancy key for the calling user (admin = self, staff = linked admin). Used by sequence RLS.';

-- ─── sequences ─────────────────────────────────────────────────────────────
create table if not exists public.sequences (
  id                  uuid primary key default gen_random_uuid(),
  mailbox_owner_id    uuid not null references auth.users (id) on delete cascade,
  created_by          uuid references auth.users (id) on delete set null,
  name                text not null,
  description         text,
  status              text not null default 'draft'
                        check (status in ('draft', 'active', 'paused', 'archived')),
  published_at        timestamptz,

  -- Delivery window
  timezone            text not null default 'Asia/Kolkata',
  send_window_start   time not null default '09:00',
  send_window_end     time not null default '17:00',
  business_days_only  boolean not null default true,
  daily_send_limit    int not null default 200 check (daily_send_limit between 1 and 2000),

  -- Composition
  thread_emails       boolean not null default true,
  include_signature   boolean not null default false,
  signature_html      text,
  track_opens         boolean not null default true,

  -- Exit criteria
  exit_on_reply       boolean not null default true,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint sequences_window_ordered check (send_window_start < send_window_end)
);

comment on table public.sequences is
  'Automated email sequence: settings and publish state. Team-scoped by mailbox_owner_id.';
comment on column public.sequences.status is
  'draft = never published; active = sending; paused = enabled off; archived = soft-deleted.';
comment on column public.sequences.timezone is
  'IANA zone (e.g. Asia/Kolkata) that the send window and business-day rules are evaluated in.';
comment on column public.sequences.daily_send_limit is
  'Per-mailbox per-local-day cap for this sequence. Guards the shared Gmail send quota.';
comment on column public.sequences.signature_html is
  'Sequence-level HTML signature. Gmail settings scope is not granted, so signatures cannot be read from Google.';

create index if not exists sequences_owner_updated_idx
  on public.sequences (mailbox_owner_id, updated_at desc);
create index if not exists sequences_owner_status_idx
  on public.sequences (mailbox_owner_id, status);

-- ─── sequence_steps ────────────────────────────────────────────────────────
create table if not exists public.sequence_steps (
  id                uuid primary key default gen_random_uuid(),
  sequence_id       uuid not null references public.sequences (id) on delete cascade,
  mailbox_owner_id  uuid not null references auth.users (id) on delete cascade,
  step_order        int not null check (step_order > 0),
  kind              text not null check (kind in ('email', 'wait')),

  -- email steps
  subject_template  text,
  body_html         text,

  -- wait steps
  delay_days        int not null default 0 check (delay_days between 0 and 365),
  delay_hours       int not null default 0 check (delay_hours between 0 and 23),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint sequence_steps_wait_has_delay
    check (kind <> 'wait' or (delay_days + delay_hours) > 0),
  unique (sequence_id, step_order)
);

comment on table public.sequence_steps is
  'Ordered steps. kind=email sends; kind=wait only advances the clock before the next email step.';
comment on column public.sequence_steps.subject_template is
  'Inline subject with {{merge_field}} placeholders (lib/mail-merge.ts). Ignored on follow-ups when the sequence threads.';
comment on column public.sequence_steps.delay_days is
  'When the sequence is business_days_only, this counts business days, not calendar days.';

create index if not exists sequence_steps_sequence_order_idx
  on public.sequence_steps (sequence_id, step_order);

-- ─── sequence_enrollments ──────────────────────────────────────────────────
create table if not exists public.sequence_enrollments (
  id                    uuid primary key default gen_random_uuid(),
  sequence_id           uuid not null references public.sequences (id) on delete cascade,
  mailbox_owner_id      uuid not null references auth.users (id) on delete cascade,
  enrolled_by           uuid references auth.users (id) on delete set null,

  email                 text not null check (email = lower(email)),
  display_name          text,
  merge_fields          jsonb not null default '{}'::jsonb,

  status                text not null default 'active'
                          check (status in ('active', 'paused', 'completed', 'replied',
                                            'bounced', 'failed', 'needs_attention', 'removed')),

  -- Scheduler state — service role only.
  current_step_order    int not null default 0,
  next_step_id          uuid references public.sequence_steps (id) on delete set null,
  next_run_at           timestamptz,
  claimed_at            timestamptz,
  claim_token           uuid,
  attempt_count         int not null default 0,
  last_error            text,

  -- Gmail threading state
  gmail_thread_id       text,
  last_gmail_message_id text,

  first_sent_at         timestamptz,
  last_sent_at          timestamptz,
  completed_at          timestamptz,
  replied_at            timestamptz,
  reply_checked_at      timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (sequence_id, email)
);

comment on table public.sequence_enrollments is
  'One recipient inside one sequence, plus its scheduler cursor. Written by the service role only.';
comment on column public.sequence_enrollments.current_step_order is
  'step_order of the last step this recipient completed; 0 = nothing sent yet.';
comment on column public.sequence_enrollments.next_run_at is
  'UTC instant the next email step is due. Null for terminal or paused enrollments.';
comment on column public.sequence_enrollments.claimed_at is
  'Lease timestamp taken by the cron. Rows become re-claimable once the lease expires.';
comment on column public.sequence_enrollments.gmail_thread_id is
  'Gmail thread of the first send. Used for follow-up threading AND for reply/bounce detection.';
comment on column public.sequence_enrollments.merge_fields is
  'Per-recipient {{merge_field}} values, keyed with normalizeMergeFieldKey() from lib/mail-merge.ts.';

-- The cron hot path: due, active, not currently leased.
create index if not exists sequence_enrollments_due_idx
  on public.sequence_enrollments (next_run_at)
  where status = 'active' and next_run_at is not null;

create index if not exists sequence_enrollments_sequence_status_idx
  on public.sequence_enrollments (sequence_id, status);
create index if not exists sequence_enrollments_owner_email_idx
  on public.sequence_enrollments (mailbox_owner_id, email);
create index if not exists sequence_enrollments_thread_idx
  on public.sequence_enrollments (gmail_thread_id)
  where gmail_thread_id is not null;

-- ─── sequence_sends ────────────────────────────────────────────────────────
create table if not exists public.sequence_sends (
  id                uuid primary key default gen_random_uuid(),
  enrollment_id     uuid not null references public.sequence_enrollments (id) on delete cascade,
  sequence_id       uuid not null references public.sequences (id) on delete cascade,
  step_id           uuid references public.sequence_steps (id) on delete set null,
  mailbox_owner_id  uuid not null references auth.users (id) on delete cascade,

  attempt           int not null default 1,
  status            text not null default 'sending'
                      check (status in ('sending', 'sent', 'failed', 'skipped')),
  to_email          text not null,
  subject           text,
  gmail_message_id  text,
  gmail_thread_id   text,
  tracking_id       uuid references public.email_tracking (id) on delete set null,
  error             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.sequence_sends is
  'Per-send log. Doubles as the idempotency guard: a sending/sent row blocks a second send of the same step.';
comment on column public.sequence_sends.status is
  'sending = claimed pre-flight; sent = Gmail accepted; failed = retryable; skipped = deliberately not sent.';

-- At-most-once per step. failed/skipped rows fall out of the index so retries are allowed.
create unique index if not exists sequence_sends_once_per_step_idx
  on public.sequence_sends (enrollment_id, step_id)
  where status in ('sending', 'sent');

create index if not exists sequence_sends_enrollment_created_idx
  on public.sequence_sends (enrollment_id, created_at desc);
create index if not exists sequence_sends_sequence_created_idx
  on public.sequence_sends (sequence_id, created_at desc);
-- Daily quota lookup per mailbox.
create index if not exists sequence_sends_owner_created_idx
  on public.sequence_sends (mailbox_owner_id, created_at desc)
  where status = 'sent';

-- ─── Atomic claim ──────────────────────────────────────────────────────────
-- Leases due enrollments so overlapping cron pings cannot both send the same step.
create or replace function public.claim_due_sequence_enrollments(
  p_limit int default 25,
  p_lease_seconds int default 300
)
returns setof public.sequence_enrollments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  return query
  with due as (
    select e.id
    from public.sequence_enrollments e
    join public.sequences s on s.id = e.sequence_id
    where e.status = 'active'
      and e.next_run_at is not null
      and e.next_run_at <= v_now
      and (e.claimed_at is null
           or e.claimed_at < v_now - make_interval(secs => p_lease_seconds))
      and s.status = 'active'
    order by e.next_run_at asc
    limit p_limit
    for update of e skip locked
  )
  update public.sequence_enrollments e
     set claimed_at  = v_now,
         claim_token = gen_random_uuid(),
         updated_at  = v_now
    from due
   where e.id = due.id
  returning e.*;
end;
$$;

comment on function public.claim_due_sequence_enrollments(int, int) is
  'Leases up to p_limit due enrollments using FOR UPDATE SKIP LOCKED. Service role only.';

-- Functions are EXECUTE-able by PUBLIC by default. Revoke that, then grant the
-- cron's role back explicitly — service_role bypasses RLS but NOT grants, so
-- without this the scheduler fails with "permission denied for function".
revoke all on function public.claim_due_sequence_enrollments(int, int)
  from public, anon, authenticated;

grant execute on function public.claim_due_sequence_enrollments(int, int)
  to service_role;

-- ─── RLS ───────────────────────────────────────────────────────────────────
alter table public.sequences            enable row level security;
alter table public.sequence_steps       enable row level security;
alter table public.sequence_enrollments enable row level security;
alter table public.sequence_sends       enable row level security;

drop policy if exists "sequences_select_team" on public.sequences;
drop policy if exists "sequences_insert_team" on public.sequences;
drop policy if exists "sequences_update_team" on public.sequences;
drop policy if exists "sequences_delete_team" on public.sequences;

-- (select ...) wraps the helper so Postgres evaluates it once per query, not per row.
create policy "sequences_select_team" on public.sequences
  for select to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()));

create policy "sequences_insert_team" on public.sequences
  for insert to authenticated
  with check (mailbox_owner_id = (select public.current_mailbox_owner_id()));

create policy "sequences_update_team" on public.sequences
  for update to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()))
  with check (mailbox_owner_id = (select public.current_mailbox_owner_id()));

create policy "sequences_delete_team" on public.sequences
  for delete to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()));

drop policy if exists "sequence_steps_select_team" on public.sequence_steps;
drop policy if exists "sequence_steps_insert_team" on public.sequence_steps;
drop policy if exists "sequence_steps_update_team" on public.sequence_steps;
drop policy if exists "sequence_steps_delete_team" on public.sequence_steps;

create policy "sequence_steps_select_team" on public.sequence_steps
  for select to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()));

create policy "sequence_steps_insert_team" on public.sequence_steps
  for insert to authenticated
  with check (mailbox_owner_id = (select public.current_mailbox_owner_id()));

create policy "sequence_steps_update_team" on public.sequence_steps
  for update to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()))
  with check (mailbox_owner_id = (select public.current_mailbox_owner_id()));

create policy "sequence_steps_delete_team" on public.sequence_steps
  for delete to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()));

-- Read-only for users: every write goes through /api/sequences/* with the service
-- role, so scheduler columns (next_run_at, claimed_at, attempt_count) cannot be forged.
drop policy if exists "sequence_enrollments_select_team" on public.sequence_enrollments;
create policy "sequence_enrollments_select_team" on public.sequence_enrollments
  for select to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()));

drop policy if exists "sequence_sends_select_team" on public.sequence_sends;
create policy "sequence_sends_select_team" on public.sequence_sends
  for select to authenticated
  using (mailbox_owner_id = (select public.current_mailbox_owner_id()));

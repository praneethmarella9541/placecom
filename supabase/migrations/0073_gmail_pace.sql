-- Shared pacing for Gmail API calls, across every server instance.
--
-- Each server process paces its own Gmail calls in memory, so N processes (several
-- Vercel instances, a dev server, a cron job) each stay under the cap while the
-- mailbox sees the sum — which is what tripped Gmail's 403 rateLimitExceeded.
-- This is the one place they all agree on: a timeline per mailbox and lane
-- ("next_free_at"). A caller reserves a window of `units / units_per_sec` seconds on
-- it and is told how long to wait before its window opens, so windows never overlap
-- and the combined rate stays at the cap.
--
-- Unlogged: this is scratch state, losing it on a crash only means a fresh timeline.
-- Service role only (RLS on, no policies, function not executable by anyone else).
--
-- Scope: per DATABASE. QA and production have separate databases, so they pace
-- separately even if both call the same Gmail account — give QA its own mailbox, or
-- point both at one database.

create unlogged table if not exists public.gmail_pace (
  key           text primary key,
  next_free_at  timestamptz not null default now()
);

alter table public.gmail_pace enable row level security;

create or replace function public.gmail_reserve(
  p_key text,
  p_units numeric,
  p_units_per_sec numeric,
  p_max_wait_ms integer default 20000
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := clock_timestamp();
  v_start timestamptz;
  v_wait  integer;
begin
  insert into public.gmail_pace (key, next_free_at) values (p_key, v_now)
    on conflict (key) do nothing;

  -- Row lock: concurrent reservations for the same key queue up here, one at a time.
  select greatest(next_free_at, v_now) into v_start
    from public.gmail_pace where key = p_key for update;

  v_wait := greatest(0, ceil(extract(epoch from (v_start - v_now)) * 1000))::integer;

  -- A queue longer than the cap isn't joined (the timeline would only grow): the
  -- caller waits the cap and proceeds, and its own pacing still applies.
  if v_wait > p_max_wait_ms then
    return p_max_wait_ms;
  end if;

  update public.gmail_pace
     set next_free_at = v_start + make_interval(secs => p_units / greatest(p_units_per_sec, 1))
   where key = p_key;
  return v_wait;
end;
$$;

revoke all on function public.gmail_reserve(text, numeric, numeric, integer) from public, anon, authenticated;
grant execute on function public.gmail_reserve(text, numeric, numeric, integer) to service_role;

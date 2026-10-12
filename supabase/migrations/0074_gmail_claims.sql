-- Small shared notes between server instances, for the background page warmer
-- (lib/gmail-warmer.ts): "someone is already warming this page", "a person is
-- using this page now — stop warming it", "Gmail throttled recently — pause", and
-- an hourly budget. Each is a keyed counter that expires on its own.
--
-- Unlogged scratch state, service role only (RLS on, no policies; functions not
-- executable by anyone else). Per database, like gmail_pace.

create unlogged table if not exists public.gmail_claims (
  key         text primary key,
  expires_at  timestamptz not null,
  n           integer not null default 1
);

alter table public.gmail_claims enable row level security;

-- Count one more event under `p_key` within a window that starts at the first event
-- and lasts p_window_ms. Returns the count so far in the window (1 = first = "I got it").
create or replace function public.gmail_bump(p_key text, p_window_ms integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  insert into public.gmail_claims as c (key, expires_at, n)
    values (p_key, clock_timestamp() + make_interval(secs => p_window_ms / 1000.0), 1)
  on conflict (key) do update
    set n          = case when c.expires_at < clock_timestamp() then 1 else c.n + 1 end,
        expires_at = case when c.expires_at < clock_timestamp()
                          then clock_timestamp() + make_interval(secs => p_window_ms / 1000.0)
                          else c.expires_at end
  returning c.n into v_n;
  return v_n;
end;
$$;

-- True if any of the keys has an unexpired note.
create or replace function public.gmail_claimed(p_keys text[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.gmail_claims where key = any(p_keys) and expires_at > clock_timestamp()
  );
$$;

-- Drop a note early.
create or replace function public.gmail_unclaim(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.gmail_claims where key = p_key;
$$;

revoke all on function public.gmail_bump(text, integer) from public, anon, authenticated;
revoke all on function public.gmail_claimed(text[]) from public, anon, authenticated;
revoke all on function public.gmail_unclaim(text) from public, anon, authenticated;
grant execute on function public.gmail_bump(text, integer) to service_role;
grant execute on function public.gmail_claimed(text[]) to service_role;
grant execute on function public.gmail_unclaim(text) to service_role;

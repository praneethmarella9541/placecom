-- Shared, persistent copy of the per-thread header data the inbox list shows.
--
-- A list row needs subject / sender / date / labels, which Gmail only returns
-- one thread at a time (threads.get, 10 quota units each) — a 50-row page costs
-- ~510 units and takes seconds, and every server instance and every teammate
-- pays it again for the same threads. Gmail's threads.list already returns each
-- thread's `historyId`, which changes whenever the thread does, so a row stored
-- here under (thread, historyId) is guaranteed current: a hit is free, a miss is
-- fetched once and stored for everyone.
--
-- What is stored: subject, sender and participant addresses, dates, labels and
-- read/star/attachment flags. NOT the snippet or any message body — the snippet
-- comes fresh from threads.list on every request.
--
-- Access: the service role only (RLS on, no policies) — the inbox API reads and
-- writes it; nothing is exposed to the browser.
-- Retention: rows not refreshed for 90 days are purged (see lib/gmail-thread-meta-store.ts),
-- and everything for a mailbox goes with it when its owner account is deleted.

create table if not exists public.gmail_thread_meta (
  mailbox_owner_id uuid not null references auth.users (id) on delete cascade,
  thread_id        text not null,
  history_id       text not null,
  subject          text not null default '',
  from_header      text not null default '',
  last_date        text not null default '',
  label_ids        text[] not null default '{}',
  unread           boolean not null default false,
  starred          boolean not null default false,
  important        boolean not null default false,
  has_attachments  boolean not null default false,
  participants     text[] not null default '{}',
  message_count    integer not null default 0,
  fetched_at       timestamptz not null default now(),
  primary key (mailbox_owner_id, thread_id)
);

comment on table public.gmail_thread_meta is
  'Inbox list header data per Gmail thread, keyed by historyId so a hit is always current. Service role only; purged after 90 days.';

create index if not exists gmail_thread_meta_fetched_at_idx
  on public.gmail_thread_meta (fetched_at);

alter table public.gmail_thread_meta enable row level security;
-- Deliberately no policies: only the service role (which bypasses RLS) can touch it.

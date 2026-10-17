-- Connectors: third-party services an account links with its own credentials (Lusha first).
--
-- One row per account (the admin's mailbox scope, like the rest of the workspace) and provider, so
-- every account brings its own API key and spends its own credits. The key is stored encrypted
-- (lib/token-crypto) and is only ever read by the server; the browser sees the last four characters.
--
-- Row-level security is on with no policies: only the service role, used by the API routes, can
-- read or write this table — the same arrangement as google_mailbox_credentials.

create table if not exists public.integration_connections (
  id                uuid primary key default gen_random_uuid(),
  mailbox_owner_id  uuid not null references auth.users (id) on delete cascade,
  provider          text not null check (provider in ('lusha')),
  api_key_encrypted text not null,
  -- Last four characters of the key, so the UI can say which key is connected without exposing it.
  key_hint          text not null,
  status            text not null default 'connected'
                      check (status in ('connected', 'invalid', 'inactive')),
  connected_by      uuid references auth.users (id) on delete set null,
  connected_at      timestamptz not null default now(),
  last_checked_at   timestamptz,
  last_error        text,
  -- Latest credits / plan / rate-limit snapshot from the provider, for display. Never a source of
  -- truth for spending: the provider is asked again before anything is revealed.
  usage             jsonb,
  updated_at        timestamptz not null default now(),
  unique (mailbox_owner_id, provider)
);

comment on table public.integration_connections is
  'Per-account third-party connections (API keys encrypted at rest). Service role only.';

alter table public.integration_connections enable row level security;

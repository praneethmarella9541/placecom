-- Auto-computed email engagement signal per lead (from the connected Gmail mailbox).
-- Populated lazily by app/api/crm/leads/[id]/email-connection, not by a trigger.

alter table public.leads
  add column if not exists email_last_interaction_at timestamptz,
  add column if not exists email_connection_strength text
    check (email_connection_strength in ('Good', 'Weak', 'Very weak', 'No communication')),
  add column if not exists email_synced_at timestamptz;

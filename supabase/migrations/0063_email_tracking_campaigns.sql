-- Groups a mail-merge send into a reportable "campaign" — one Send click,
-- one campaign, matching the same model as Mergo's own campaigns. Nothing
-- here changes how email_tracking is written for a normal one-off send
-- (campaign_id stays null); a mass send from the inbox composer is what
-- stamps it. gmail_thread_id + replied/bounced let the campaign report
-- answer "did they respond" the same way lib/sequence-runner.ts already does
-- for sequence enrollments, without a second polling job — computed live and
-- cached back once settled (see app/api/campaigns/[campaignId]/route.ts).

alter table public.email_tracking
  add column if not exists campaign_id uuid,
  add column if not exists campaign_name text,
  add column if not exists gmail_thread_id text,
  add column if not exists replied boolean not null default false,
  add column if not exists replied_at timestamptz,
  add column if not exists bounced boolean not null default false,
  add column if not exists bounced_at timestamptz;

create index if not exists email_tracking_campaign_idx
  on public.email_tracking (user_id, campaign_id)
  where campaign_id is not null;

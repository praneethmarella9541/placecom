-- Sends scheduled from the composer are campaigns, so they show in the Campaigns report like an
-- immediate mass send. The scheduler now stamps new sends itself; this stamps the ones that went out
-- before that change, found through the send log. Only flows with origin = 'scheduled' (a column
-- added in 0076) are touched, and rows that already carry a campaign are left alone, so it is safe
-- to run more than once.

update public.email_tracking t
set campaign_id = s.id,
    campaign_name = s.name,
    -- Campaigns lists a person's own rows, so credit the send to whoever scheduled it.
    user_id = coalesce(s.created_by, t.user_id),
    gmail_thread_id = coalesce(t.gmail_thread_id, ss.gmail_thread_id)
from public.sequence_sends ss
join public.sequences s on s.id = ss.sequence_id
where ss.tracking_id = t.id
  and s.origin = 'scheduled'
  and t.campaign_id is null;

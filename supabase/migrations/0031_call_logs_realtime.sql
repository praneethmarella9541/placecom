-- Enable Supabase Realtime on call_logs so the mobile app can show incoming-call
-- alerts immediately when Exotel hits /api/calls/connect (without waiting on push).
alter table public.call_logs replica identity full;
alter publication supabase_realtime add table public.call_logs;

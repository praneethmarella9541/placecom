-- Add new stages to the existing enum
alter type public.lead_stage add value if not exists 'Relationship Mgt';
alter type public.lead_stage add value if not exists 'JD Expected';
alter type public.lead_stage add value if not exists 'JD Received';
alter type public.lead_stage add value if not exists 'Drive Scheduled';

-- Create the new lead_type enum
create type public.lead_type as enum ('New Lead', 'Regular Recruiter');

-- Add new columns to the leads table
alter table public.leads 
  add column if not exists lead_type public.lead_type not null default 'New Lead',
  add column if not exists jd_count int not null default 0;

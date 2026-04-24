-- Per extraction job: OpenAI token usage and estimated USD cost (gpt-4o by default).

alter table public.extraction_jobs
  add column if not exists openai_input_tokens bigint not null default 0,
  add column if not exists openai_output_tokens bigint not null default 0,
  add column if not exists openai_cost_usd numeric(14,6) not null default 0;

comment on column public.extraction_jobs.openai_cost_usd is
  'Estimated API cost for this job in USD (from batch usage × model price env defaults).';

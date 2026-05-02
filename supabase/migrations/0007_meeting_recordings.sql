create table if not exists public.meeting_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  meeting_url text not null,
  fireflies_id text,
  status text default 'pending',
  transcript text,
  created_at timestamp with time zone default now()
);

alter table public.meeting_recordings enable row level security;

create policy "Users can view their own meeting recordings"
  on public.meeting_recordings for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own meeting recordings"
  on public.meeting_recordings for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own meeting recordings"
  on public.meeting_recordings for update
  using ( auth.uid() = user_id );

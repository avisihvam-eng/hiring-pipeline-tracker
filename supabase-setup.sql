-- Hiring Pipeline Tracker — Supabase Table Setup
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)

-- 1. Candidates table
create table if not exists hiring_pipeline (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  location text,
  role text,
  client text,
  current_stage text default 'Internal Screen',
  stage_status text default 'Pending',
  date date,
  notes text,
  created_at timestamp with time zone default now()
);

-- 2. Stage history table
create table if not exists pipeline_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references hiring_pipeline(id) on delete cascade,
  stage text,
  status text,
  note text,
  timestamp timestamp with time zone default now()
);

-- 3. Enable Row Level Security
alter table hiring_pipeline enable row level security;
alter table pipeline_history enable row level security;

-- 4. Allow anonymous access (no auth in v1)
create policy "Allow all on hiring_pipeline" on hiring_pipeline for all using (true) with check (true);
create policy "Allow all on pipeline_history" on pipeline_history for all using (true) with check (true);

-- ============================================
-- Hiring Pipeline Tracker — Production SQL Setup
-- Run this ENTIRE script in Supabase SQL Editor
-- ============================================

-- 1. Candidates table (idempotent)
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
  created_at timestamp with time zone default now(),
  screened_by_1 text,
  screened_by_2 text,
  interviewed_by_1 text,
  interviewed_by_2 text
);

-- Add columns if they don't exist (safe for existing tables)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name='hiring_pipeline' and column_name='screened_by_1') then
    alter table hiring_pipeline add column screened_by_1 text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='hiring_pipeline' and column_name='screened_by_2') then
    alter table hiring_pipeline add column screened_by_2 text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='hiring_pipeline' and column_name='interviewed_by_1') then
    alter table hiring_pipeline add column interviewed_by_1 text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name='hiring_pipeline' and column_name='interviewed_by_2') then
    alter table hiring_pipeline add column interviewed_by_2 text;
  end if;
end $$;

-- 2. Stage history table (idempotent)
create table if not exists pipeline_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid references hiring_pipeline(id) on delete cascade,
  stage text,
  status text,
  note text,
  timestamp timestamp with time zone default now()
);

-- 3. Allowed users whitelist
create table if not exists allowed_users (
  email text primary key
);

-- Insert the approved recruiter emails
insert into allowed_users (email) values
  ('avinash.shukla@agreeya.com'),
  ('gaurav.mehta@agreeya.com'),
  ('utkarsh.singh@agreeya.com'),
  ('vishal.mittal@agreeya.com')
on conflict (email) do nothing;

-- 4. Audit log table
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  user_email text,
  action text,
  candidate_name text,
  changed_at timestamp with time zone default now()
);

-- 5. Enable RLS on ALL tables
alter table hiring_pipeline enable row level security;
alter table pipeline_history enable row level security;
alter table allowed_users enable row level security;
alter table audit_log enable row level security;

-- 6. Drop old permissive policies (ignore errors if they don't exist)
do $$
begin
  drop policy if exists "Allow all on hiring_pipeline" on hiring_pipeline;
  drop policy if exists "Allow all on pipeline_history" on pipeline_history;
end $$;

-- 7. Create authenticated-only policies

-- hiring_pipeline: full CRUD for authenticated users
create policy "auth_select_hiring_pipeline" on hiring_pipeline
  for select to authenticated using (true);
create policy "auth_insert_hiring_pipeline" on hiring_pipeline
  for insert to authenticated with check (true);
create policy "auth_update_hiring_pipeline" on hiring_pipeline
  for update to authenticated using (true) with check (true);
create policy "auth_delete_hiring_pipeline" on hiring_pipeline
  for delete to authenticated using (true);

-- hiring_pipeline: read-only for anonymous visitors
create policy "anon_select_hiring_pipeline" on hiring_pipeline
  for select to anon using (true);

-- pipeline_history: full CRUD for authenticated users
create policy "auth_select_pipeline_history" on pipeline_history
  for select to authenticated using (true);
create policy "auth_insert_pipeline_history" on pipeline_history
  for insert to authenticated with check (true);
create policy "auth_update_pipeline_history" on pipeline_history
  for update to authenticated using (true) with check (true);
create policy "auth_delete_pipeline_history" on pipeline_history
  for delete to authenticated using (true);

-- pipeline_history: read-only for anonymous visitors
create policy "anon_select_pipeline_history" on pipeline_history
  for select to anon using (true);

-- audit_log: SELECT and INSERT only for authenticated users
create policy "auth_select_audit_log" on audit_log
  for select to authenticated using (true);
create policy "auth_insert_audit_log" on audit_log
  for insert to authenticated with check (true);

-- allowed_users: SELECT for anon (needed for login check) and authenticated
create policy "anon_select_allowed_users" on allowed_users
  for select to anon using (true);
create policy "auth_select_allowed_users" on allowed_users
  for select to authenticated using (true);

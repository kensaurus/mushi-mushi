-- Async generation queue for the Bug Intelligence weekly digest.
-- Before this migration, POST /v1/admin/intelligence ran the LLM call inline
-- which made the UI hang for 30s+ while the spinner spun forever. We now
-- enqueue a job, kick the worker, and let the page poll status.

create table if not exists public.intelligence_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  trigger text not null default 'manual',
  status text not null default 'queued', -- queued | running | completed | failed | cancelled
  report_id uuid references public.intelligence_reports(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists intelligence_generation_jobs_project_idx
  on public.intelligence_generation_jobs(project_id, created_at desc);
create index if not exists intelligence_generation_jobs_user_idx
  on public.intelligence_generation_jobs(requested_by, created_at desc);
create index if not exists intelligence_generation_jobs_status_idx
  on public.intelligence_generation_jobs(status, created_at desc);

alter table public.intelligence_generation_jobs enable row level security;

-- Owners and project members can see their own project's jobs.
drop policy if exists intelligence_generation_jobs_select on public.intelligence_generation_jobs;
create policy intelligence_generation_jobs_select on public.intelligence_generation_jobs
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = intelligence_generation_jobs.project_id
        and p.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.project_members m
      where m.project_id = intelligence_generation_jobs.project_id
        and m.user_id = (select auth.uid())
    )
  );

-- Admin endpoints write via the service role which bypasses RLS, so we
-- intentionally do not grant insert/update to authenticated users.

-- ---------------------------------------------------------------------------
-- Fix Attempts
-- ---------------------------------------------------------------------------
create table if not exists fix_attempts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  agent text not null,
  branch text,
  pr_url text,
  commit_sha text,
  status text not null default 'pending',
  files_changed text[],
  lines_changed int,
  summary text,
  review_passed boolean,
  review_reasoning text,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_fix_report on fix_attempts(report_id);
create index if not exists idx_fix_project on fix_attempts(project_id, status);

alter table fix_attempts enable row level security;

-- ---------------------------------------------------------------------------
-- Extend reports table
-- ---------------------------------------------------------------------------
alter table reports add column if not exists fix_branch text;
alter table reports add column if not exists fix_pr_url text;
alter table reports add column if not exists fix_commit_sha text;
alter table reports add column if not exists fixed_at timestamptz;

-- ---------------------------------------------------------------------------
-- Extend project_settings table
-- ---------------------------------------------------------------------------
alter table project_settings add column if not exists autofix_agent text default 'claude_code';
alter table project_settings add column if not exists autofix_max_lines int default 200;
alter table project_settings add column if not exists autofix_scope_restriction text default 'component';
alter table project_settings add column if not exists autofix_enabled boolean default false;
alter table project_settings add column if not exists github_repo_url text;
alter table project_settings add column if not exists github_deploy_key text;

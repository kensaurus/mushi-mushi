-- report_external_issues: tracks the mapping between a Mushi report and
-- an issue/ticket created in an external system (Jira, Linear, GitHub, PagerDuty).
-- Used by resolveExternalIssue() to find the external IDs to close/transition
-- when Mushi marks a report as resolved.
create table if not exists public.report_external_issues (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  system text not null check (system in ('jira', 'linear', 'github', 'pagerduty', 'sentry', 'bugsnag', 'rollbar')),
  external_id text not null,        -- ticket key / issue number / dedup_key
  external_url text,                -- deeplink to the external issue
  resolved_at timestamptz,          -- null = still open upstream
  created_at timestamptz not null default now(),
  unique(report_id, system, external_id)
);

create index report_external_issues_report_id_idx on public.report_external_issues(report_id);
create index report_external_issues_project_id_idx on public.report_external_issues(project_id);

-- Row-level security: edge functions use service role so bypass RLS,
-- but future direct API access should be scoped.
alter table public.report_external_issues enable row level security;

-- Service role full access (edge functions)
create policy "service role full access" on public.report_external_issues
  for all using (auth.role() = 'service_role');

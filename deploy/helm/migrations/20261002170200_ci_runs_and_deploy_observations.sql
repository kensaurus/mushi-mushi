-- ============================================================================
-- 20261002170200_ci_runs_and_deploy_observations
--
-- Plan 019 §5.1 migrations 3 and 4 (Phase 2, gate struck by ADR 0017).
-- ADDITIVE: apply BEFORE deploying the api and recipe-collector functions.
--
--   ci_workflow_runs     default-branch workflow runs read by the GitHub
--                        connector (or pushed by legacy CI via
--                        POST /v1/ingest/recipe/events), with ESTIMATED
--                        billable minutes (GitHub closed the usage APIs).
--   deploy_observations  what each declared deploy target actually runs
--                        (version.json probe, GitHub deployment, SDK heartbeat,
--                        connector, webhook, OTel).
-- Both keep 90 days (retention below runs from the existing retention-sweep
-- cron via the helper function this migration adds).
--
-- Verify after apply:
--   select count(*) from information_schema.tables where table_schema='public'
--     and table_name in ('ci_workflow_runs','deploy_observations');   -- 2
--   select relrowsecurity from pg_class where relname in ('ci_workflow_runs','deploy_observations'); -- t, t
--   select public.recipe_observations_prune(90);                       -- returns a count, no error
-- ============================================================================

create table if not exists public.ci_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  repo text not null check (char_length(repo) between 3 and 200),
  run_id bigint not null,
  workflow_path text,
  name text,
  event text,
  head_branch text,
  head_sha text,
  status text,
  conclusion text,
  started_at timestamptz,
  completed_at timestamptz,
  est_billable_minutes numeric,
  runner_breakdown jsonb,
  html_url text,
  source text not null default 'github' check (source in ('github', 'webhook')),
  created_at timestamptz not null default now(),
  unique (project_id, repo, run_id)
);
create index if not exists ci_workflow_runs_project on public.ci_workflow_runs (project_id, started_at desc);

create table if not exists public.deploy_observations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  target_id text not null check (char_length(target_id) between 1 and 80),
  kind text,
  environment text,
  observed_version text,
  observed_commit text,
  source text not null check (source in ('version_json', 'github_deployment', 'sdk_heartbeat', 'connector', 'webhook', 'otel')),
  ok boolean not null,
  error text,
  observed_at timestamptz not null default now()
);
create index if not exists deploy_observations_project on public.deploy_observations (project_id, target_id, observed_at desc);

-- organization_id is denormalized from projects, like app_recipe_snapshots.
create or replace function public.recipe_rows_set_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select p.organization_id into new.organization_id from public.projects p where p.id = new.project_id;
  return new;
end;
$$;
revoke all on function public.recipe_rows_set_org() from public, anon, authenticated;

drop trigger if exists ci_workflow_runs_set_org on public.ci_workflow_runs;
create trigger ci_workflow_runs_set_org before insert or update of project_id on public.ci_workflow_runs
  for each row execute function public.recipe_rows_set_org();
drop trigger if exists deploy_observations_set_org on public.deploy_observations;
create trigger deploy_observations_set_org before insert or update of project_id on public.deploy_observations
  for each row execute function public.recipe_rows_set_org();

alter table public.ci_workflow_runs enable row level security;
alter table public.deploy_observations enable row level security;

drop policy if exists ci_workflow_runs_member_select on public.ci_workflow_runs;
create policy ci_workflow_runs_member_select on public.ci_workflow_runs
  for select to authenticated using ((select private.is_project_member(project_id)));
drop policy if exists ci_workflow_runs_service_write on public.ci_workflow_runs;
create policy ci_workflow_runs_service_write on public.ci_workflow_runs
  for all to service_role using (true) with check (true);

drop policy if exists deploy_observations_member_select on public.deploy_observations;
create policy deploy_observations_member_select on public.deploy_observations
  for select to authenticated using ((select private.is_project_member(project_id)));
drop policy if exists deploy_observations_service_write on public.deploy_observations;
create policy deploy_observations_service_write on public.deploy_observations
  for all to service_role using (true) with check (true);

revoke all on table public.ci_workflow_runs, public.deploy_observations from anon;
grant select on table public.ci_workflow_runs, public.deploy_observations to authenticated;

-- 90-day retention, called from recipe-collector after each daily run.
create or replace function public.recipe_observations_prune(p_days integer default 90)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  m integer := 0;
begin
  delete from public.ci_workflow_runs where coalesce(completed_at, created_at) < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  delete from public.deploy_observations where observed_at < now() - make_interval(days => p_days);
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke all on function public.recipe_observations_prune(integer) from public, anon, authenticated;
grant execute on function public.recipe_observations_prune(integer) to service_role;

notify pgrst, 'reload schema';

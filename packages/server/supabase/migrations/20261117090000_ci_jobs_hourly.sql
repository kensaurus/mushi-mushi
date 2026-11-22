-- Jobs started per UTC hour, for the CI page's week heatmap and pass rate per day (2026-11-17).
--
-- The CI overview reads at most 1,000 finished jobs, and a busy day fills that in a few hours
-- (1,005 jobs across 8 hours on 2026-11-17), so a heatmap drawn from that list was blank for
-- the rest of the week. This counts the whole window in the database instead. One index range
-- scan per project on idx_ci_jobs_project_created.
--
-- Called by the api edge function with the service role only; it takes project ids the caller
-- has already been authorised for (loadCiOverviewRows), so it is not exposed to clients.

create or replace function public.ci_jobs_hourly(p_project_ids uuid[], p_from timestamptz)
returns table (
  hour timestamptz,
  jobs bigint,
  passed bigint,
  code_failures bigint,
  infra_failures bigint
)
language sql
stable
set search_path = ''
as $$
  select
    date_trunc('hour', j.gh_created_at, 'UTC') as hour,
    count(*) as jobs,
    count(*) filter (where j.ci_kind = 'passed') as passed,
    count(*) filter (where j.ci_kind = 'code_failure') as code_failures,
    count(*) filter (where j.infra and j.status = 'completed') as infra_failures
  from public.ci_jobs j
  where j.project_id = any (p_project_ids)
    and j.gh_created_at >= p_from
  group by 1
  order by 1
$$;

revoke all on function public.ci_jobs_hourly(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.ci_jobs_hourly(uuid[], timestamptz) to service_role;

comment on function public.ci_jobs_hourly(uuid[], timestamptz) is
  'Jobs, passes, code failures and machine stops per UTC hour since p_from for the given projects (CI page week heatmap). Service role only.';

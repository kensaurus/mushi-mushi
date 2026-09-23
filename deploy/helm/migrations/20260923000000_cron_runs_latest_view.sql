-- Latest run per cron job, for the Health page's Cron panel and the
-- "Is the AI brain healthy?" probe (api/routes/health.ts).
--
-- Both handlers used to read the 100 most recent cron_runs rows overall and
-- look for the jobs they care about inside that window. Three jobs run every
-- minute (fix-dispatch-sweeper, qa-story-runner, plugin-dispatch-retry), so
-- 100 rows span roughly 40 minutes and anything nightly or weekly never
-- appears. judge-batch (192 runs), intelligence-report (24) and data-retention
-- (159) were all running on schedule while the console reported every one as
-- "never run" and put a "3 scheduled jobs missed their expected run time"
-- warning on the dashboard.
--
-- DISTINCT ON gives one row per job_name regardless of how chatty the
-- minute-jobs are. security_invoker + no grant to authenticated keeps the
-- posture of cron_runs itself (authenticated reads were dropped in
-- 20260624110000_rls_tighten_phase2); only the service client reads it.
create or replace view public.cron_runs_latest
with (security_invoker = true) as
select distinct on (job_name) *
from public.cron_runs
order by job_name, started_at desc;

comment on view public.cron_runs_latest is
  'Most recent cron_runs row per job_name. Read by api/routes/health.ts so nightly/weekly jobs are not reported as never-run just because minute-jobs crowd the recent window.';

grant select on public.cron_runs_latest to service_role;

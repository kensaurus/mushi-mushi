-- ============================================================================
-- 20260924000900_cron_history_retention
--
-- Neither job log had ever been pruned. Measured 2026-09-24:
--   cron.job_run_details  1,093,647 rows / 360 MB, oldest row 2026-04-17
--   public.cron_runs        480,810 rows / 154 MB, oldest row 2026-04-17
--
-- 1. cron.job_run_details is pg_cron's own run log: scheduler log lines, not
--    app data. The only database object that mentions it is Supabase's
--    extensions.grant_pg_cron_access(), and no repo code reads its history.
--    Keep 7 days.
--
-- 2. public.cron_runs is Mushi's job log (job name, status, row count, error,
--    metadata; no project or user column, service-role RLS only). Readers:
--      - cron_runs_latest (health page, doctor, admin-ops) and
--        recover_stranded_pipeline() read only the newest row per job;
--      - admin_chart_events turns non-success rows into chart annotations,
--        and the Judge page overlays them on about 12 weeks of scores.
--    So 'success' rows keep 30 days, every other status keeps 90 days, and
--    each job's newest row is never deleted: a weekly or paused job must not
--    drop out of cron_runs_latest and read as "never run".
--
-- Both jobs run once a day and are idempotent: any earlier copy is
-- unscheduled by name first. The one-time trim of the existing backlog ran
-- in 20k-row batches outside this migration.
-- ============================================================================

select cron.unschedule(jobid) from cron.job where jobname = 'mushi-cron-history-retention';

select cron.schedule(
  'mushi-cron-history-retention',
  '41 5 * * *',
  $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$
);

select cron.unschedule(jobid) from cron.job where jobname = 'mushi-cron-runs-retention';

select cron.schedule(
  'mushi-cron-runs-retention',
  '47 5 * * *',
  $job$delete from public.cron_runs r
        using (select job_name, max(started_at) as newest
                 from public.cron_runs
                group by job_name) l
        where r.job_name = l.job_name
          and r.started_at < l.newest
          and r.started_at < now() - interval '30 days'
          and (r.status = 'success' or r.started_at < now() - interval '90 days')$job$
);

do $verify$
declare
  v_count int;
begin
  select count(*) into v_count
    from cron.job
   where active
     and (jobname, schedule) in (('mushi-cron-history-retention', '41 5 * * *'),
                                 ('mushi-cron-runs-retention',    '47 5 * * *'));
  if v_count <> 2 then
    raise exception 'cron history retention jobs were not scheduled as expected (found %)', v_count;
  end if;
end
$verify$;

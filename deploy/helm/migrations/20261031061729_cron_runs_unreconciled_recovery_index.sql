-- recover_stranded_pipeline() starts by finding the last pipeline-recovery run
-- it has not reconciled yet. That read walked every pipeline-recovery row
-- (8,979 of them, 4.7k buffers, 15 ms of a 28 ms run) on every cron tick. A
-- partial index matching the function's literal filter holds only the
-- unreconciled rows, so the lookup reads one or two.
create index if not exists idx_cron_runs_unreconciled_recovery
  on public.cron_runs (finished_at desc)
  where job_name = 'pipeline-recovery'
    and metadata ? 'request_ids'
    and not (metadata ? 'reconciled');

-- cron_runs_latest is `DISTINCT ON (job_name) … ORDER BY job_name, started_at
-- DESC` over every cron_runs row. Without an index on that order, each call
-- seq-scanned the table: 117k rows, 128 MB of buffers (77 MB from disk) to
-- return 67, 563 ms on 2026-10-09. The health pages poll it, and on 2026-10-08
-- (00:30 UTC) those scans drained the disk IO budget until unrelated writes
-- (a one-row sourcemaps upsert, Sentry MUSHI-MUSHI-SERVER-2C) hit the 8 s
-- statement timeout.
--
-- A filter on job_name pushes through DISTINCT ON into this index, so the
-- view reads only the matching jobs' entries in order.
create index if not exists idx_cron_runs_job_started
  on public.cron_runs (job_name, started_at desc);

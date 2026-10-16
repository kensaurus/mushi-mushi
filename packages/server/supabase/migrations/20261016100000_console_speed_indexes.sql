-- ============================================================================
-- Console speed: two indexes the console's hottest reads were missing
-- (2026-10-16). CREATE INDEX CONCURRENTLY cannot run inside a transaction, so
-- this file holds nothing else; on prod build each statement on its own
-- (one-shot pg_cron job), not through a transactional migration runner.
--
--   1. integration_health_history (project_id, checked_at desc)
--      include (kind, status)
--      integration_health_rollup (inbox/stats, dashboard, dashboard/stats)
--      filters `project_id = any(...) and checked_at >= since`, and the
--      health / integrations panels read `project_id = $1 order by
--      checked_at desc limit n`. The only index was (project_id), so the
--      rollup read all 372,909 rows to keep the 45,285 inside 14 days
--      (EXPLAIN 2026-10-16: 55,851 buffers, 341 ms warm; pg_stat_statements
--      max 7.76 s, the SQLSTATE 57014 statement timeouts behind Sentry
--      MUSHI-MUSHI-SERVER-2E on /v1/admin/inbox/stats). The rollup's header
--      comment named a (project_id, kind, checked_at desc) index that no
--      migration ever created. kind leads nothing here: with
--      project_id = any(...) Postgres 17 cannot skip-scan past kind to bound
--      checked_at. INCLUDE lets the rollup read the index alone.
--
--   2. project_codebase_files (project_id) where symbol_name is null and
--      tombstoned_at is null
--      The live indexed-file count (setup checklist, /projects,
--      console_project_counts) visited the heap for every row: 30 ms per
--      project, 6,637 buffers for 13 projects. The partial index makes it an
--      index-only count.
--
--   3. cron_runs (started_at desc)
--      The health route (api/routes/health.ts) reads `cron_runs order by
--      started_at desc limit 100`. The only started_at index leads with
--      job_name, so each call sorted the whole 162 MB / 122,994-row table
--      (EXPLAIN 2026-10-16: parallel seq scan, 9,876 buffers read from disk,
--      742 ms). The same statement timed out alongside the inbox/stats 57014
--      events on 2026-10-15 00:10-00:12 UTC (postgres logs).
-- ============================================================================

create index concurrently if not exists idx_integration_health_history_project_checked
  on public.integration_health_history (project_id, checked_at desc)
  include (kind, status);

create index concurrently if not exists idx_codebase_files_live_file_rows
  on public.project_codebase_files (project_id)
  where symbol_name is null and tombstoned_at is null;

create index concurrently if not exists idx_cron_runs_started
  on public.cron_runs (started_at desc);

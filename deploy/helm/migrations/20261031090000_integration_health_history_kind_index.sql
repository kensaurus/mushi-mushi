-- ============================================================================
-- integration_health_history (project_id, kind, checked_at desc)
-- (2026-10-31). CREATE INDEX CONCURRENTLY cannot run inside a transaction, so
-- this file holds nothing else; on prod build it on its own (as
-- 20261016100000_console_speed_indexes.sql was), not through a
-- transactional migration runner.
--
-- Three readers ask for one kind of one project, newest or oldest first:
--   - setup-gaps.ts slackTokenGap: kind = 'slack' order by checked_at desc limit 1
--   - _shared/radar/operator.ts: kind = $k order by checked_at desc limit 1
--   - integration-health-probe/radar-pass.ts firstHealthRow: kind = $k
--     order by checked_at asc limit 1
-- The only fitting index, idx_integration_health_history_project_checked
-- (project_id, checked_at desc) include (kind, status), walks every row the
-- project has until one matches the kind. For a project without that kind
-- it reads them all: EXPLAIN 2026-10-31 on solo-boss-cloud, kind 'slack',
-- 46,132 rows removed by filter, 2,866 buffers from disk, 2.1 s idle;
-- pg_stat_statements logged the same statement at 6.8 s, close to the 8 s
-- statement_timeout behind the 57014 DbErrors on the console's stats routes
-- (MUSHI-MUSHI-SERVER-36/38/39). The table holds 373k rows and gains a row
-- per kind per project every 15 minutes.
--
-- The (project_id, checked_at) index stays: integration_health_rollup
-- filters project_id = any(...) and checked_at >= since, which a leading
-- kind cannot serve (see 20261016100000).
-- ============================================================================

create index concurrently if not exists idx_integration_health_history_project_kind_checked
  on public.integration_health_history (project_id, kind, checked_at desc);

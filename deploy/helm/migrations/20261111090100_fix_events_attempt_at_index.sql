-- ============================================================================
-- fix_events (fix_attempt_id, at desc) (2026-11-11). CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction, so this file holds nothing
-- else; on prod build it on its own (as 20261031090000 was), not through a
-- transactional migration runner.
--
-- GET /v1/admin/repo/activity (query-fixes-repo.ts) reads the stored events
-- of the project's newest fix attempts:
--   project_id = $p and fix_attempt_id = any($200 ids) order by at desc limit 2000
-- No index leads with fix_attempt_id except idx_fix_events_dedupe, which is
-- partial (dedupe_key is not null) and cannot serve it. The plan reads every
-- event of the project through idx_fix_events_project_id and filters: EXPLAIN
-- ANALYZE 2026-11-11 on glot.it, 20,395 rows read, 14,579 removed by filter,
-- 3,437 heap blocks, 38 ms warm. The read grows with the project's whole
-- history rather than with the 200 attempts shown. The same statement was
-- cancelled by the 8s statement_timeout on 2026-10-29 04:17 UTC, and the
-- route paged as Sentry 7809785022 (57014) while the instance was under
-- load. The table holds 80k rows (55 MB), so the build is short.
--
-- This index answers fix_attempt_id = any(...) by index scan per attempt,
-- already ordered by `at`. The live timeline streams in a2a-tasks.ts and
-- fix-dispatch.ts (fix_attempt_id = $id and at > $last order by at) poll
-- that shape too, with no project filter: today each poll is a sequential
-- scan of the whole table (EXPLAIN ANALYZE 2026-11-11: 80,262 rows removed
-- by filter to return 34, 4,730 buffers).
-- ============================================================================

create index concurrently if not exists idx_fix_events_attempt_at
  on public.fix_events (fix_attempt_id, at desc);

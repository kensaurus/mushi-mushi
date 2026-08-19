-- ─────────────────────────────────────────────────────────────────────────────
-- Stagger the pg_cron → edge-function thundering herd.
--
-- WHY: every */5, */10, */15, and hourly cron job fired on the same minute
-- boundaries (:00, :05, :15, :30, …), so at the top of each hour ~10 edge
-- functions (ci-sync, synthetic-monitor, integration-health-probe,
-- sentry-seer-poll, status-reconciler, usage-alerts, qa-story-runner, mcp
-- probes, …) all spun up workers simultaneously. The shared edge runtime
-- briefly marked itself degraded and shed concurrent guest traffic with
--   503 SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED  (and occasional 502s)
-- on /functions/v1/api/* — observed 26×503 + 5×502 per day on the SDK
-- ingest routes (/v1/sdk/session, /v1/reporter/reports, …), every one of
-- them timestamped at a :00/:05/:30 cron boundary (2026-08-18/19 logs).
--
-- FIX: give every non-minutely edge-invoking job its own firing minute.
-- After this migration no two of them share a minute, and the :00 boundary
-- carries no recurring edge invocations at all. SQL-only jobs (matview
-- refreshes, expiry UPDATEs) are untouched — they never hit the edge runtime.
-- The every-minute jobs (qa-story-runner-tick, mushi-plugin-dispatch-retry)
-- are the designed steady-state load and stay as-is.
--
-- Minute map (hourly view) after this migration:
--   :01,06,…56  status-reconciler        (1-56/5)
--   :02,12,…52  ci-sync                  (2-52/10)
--   :03,18,33,48 synthetic-monitor       (3-48/15)
--   :04,19,34,49 integration-health-probe(4-49/15)
--   :07         anomaly-detector         (unchanged)
--   :08,23,38,53 sentry-seer-poll        (8-53/15)
--   :09         usage-aggregator         (was :07, collided with anomaly)
--   :13         usage-alerts             (was :00; now also runs AFTER the
--                                         :09 aggregation it reads from)
--   :17         repo-indexer             (unchanged)
--   :24         inventory-drift-watch    (was :17, collided with repo-indexer)
--   :37 (*/6h)  pdca-runner              (was :00)
--   03:14       judge-batch              (was 03:00, collided with retention)
--   03:27       retention-sweep          (was 03:00)
--
-- Uses cron.alter_job so each job's live command/database/username are
-- preserved verbatim — only the schedule changes. Missing jobs are a no-op.
--
-- ROLLBACK (inverse schedules):
--   mushi-status-reconciler-tick   */5 * * * *
--   mushi-ci-sync-10m              */10 * * * *
--   mushi-synthetic-monitor-tick   */15 * * * *
--   mushi-integration-health-probe */15 * * * *
--   mushi-sentry-seer-poll-15m     */15 * * * *
--   mushi-usage-aggregator-hourly  7 * * * *
--   usage-alerts-hourly            0 * * * *
--   mushi-inventory-drift-watch    17 * * * *
--   pdca-qa-story-improve          0 */6 * * *
--   mushi-judge-batch-nightly      0 3 * * *
--   mushi-retention-sweep-daily    0 3 * * *
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  target record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping edge cron stagger';
    RETURN;
  END IF;

  FOR target IN
    SELECT v.jobname, v.new_schedule
      FROM (VALUES
        ('mushi-status-reconciler-tick',   '1-56/5 * * * *'),
        ('mushi-ci-sync-10m',              '2-52/10 * * * *'),
        ('mushi-synthetic-monitor-tick',   '3-48/15 * * * *'),
        ('mushi-integration-health-probe', '4-49/15 * * * *'),
        ('mushi-sentry-seer-poll-15m',     '8-53/15 * * * *'),
        ('mushi-usage-aggregator-hourly',  '9 * * * *'),
        ('usage-alerts-hourly',            '13 * * * *'),
        ('mushi-inventory-drift-watch',    '24 * * * *'),
        ('pdca-qa-story-improve',          '37 */6 * * *'),
        ('mushi-judge-batch-nightly',      '14 3 * * *'),
        ('mushi-retention-sweep-daily',    '27 3 * * *')
      ) AS v(jobname, new_schedule)
  LOOP
    PERFORM cron.alter_job(job_id => j.jobid, schedule => target.new_schedule)
       FROM cron.job j
      WHERE j.jobname = target.jobname;

    IF NOT FOUND THEN
      RAISE NOTICE 'cron job % not found; skipped', target.jobname;
    END IF;
  END LOOP;
END $$;

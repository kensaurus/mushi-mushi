/*
FILE: 20261003193100_sdk_release_sync_cron.sql
PURPOSE: Schedule sdk-release-sync every 5 minutes.

OVERVIEW:
- config.toml and AGENTS.md describe sdk-release-sync as a 5-minute cron,
  but no migration ever scheduled it, and cron.job on production
  (checked 2026-10-03) had no entry for it. The release-cockpit chips only
  moved when someone pressed Sync.
- ADR 0019 makes it load-bearing: it is the only thing that opens the PR
  for an sdk_upgrade_jobs row in 'awaiting_lockfile'. Without it such a row
  holds the project's upgrade slot until an operator cancels it.

NOTES:
- Same helper and shape as the other function crons
  (20260922000010_cron_repairs_and_http_watchdog.sql). cron.schedule with an
  existing name replaces that job, so this is safe to re-run.
- Off the minute boundary (2,7,…,57) to spread load from the other crons.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-sdk-release-sync-5m schedule';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'mushi-sdk-release-sync-5m',
    '2-57/5 * * * *',
    $cmd$select mushi.cron_http_post('sdk-release-sync', jsonb_build_object('trigger', 'cron'), 60000);$cmd$
  );
END $$;

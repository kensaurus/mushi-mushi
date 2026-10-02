-- Rollback for 20261002160100_reporter_digest_cron.
-- Deferred emails then stay deferred (never sent) until the cron returns.

DO $$
BEGIN
  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-reporter-digest';
END $$;

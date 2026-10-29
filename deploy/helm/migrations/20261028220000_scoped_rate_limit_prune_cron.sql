-- =============================================================================
-- Prune old rate-limit windows daily.
--
-- scoped_rate_limits holds one row per actor and window. For IP-keyed limits
-- (the free Production Check, the cookieless page-view count, CLI device auth)
-- the actor is a salted hash of the visitor's IP. scoped_rate_limit_prune()
-- existed but nothing ran it, so rows from 2026-04 were still there (63,669 on
-- 2026-10-28). A window older than 7 days limits nothing, and the privacy
-- policy (v3) says these hashes are only used against flooding, so delete them.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-rate-limit-prune';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-rate-limit-prune';
  PERFORM cron.schedule(
    'mushi-rate-limit-prune',
    '17 3 * * *',
    $cmd$select public.scoped_rate_limit_prune(interval '7 days');$cmd$
  );
END $$;

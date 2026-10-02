-- ============================================================================
-- 20261002160100_reporter_digest_cron
--
-- VALUE SWITCH — apply AFTER deploying `reporter-notify-fanout` with digest
-- mode. Applied earlier, the cron would post `{"digest":true}` to the old
-- function, which answers 400 (comment_id required) every day until deploy.
--
-- Plan 018 §4.3: emails over the frequency cap are stored as `deferred`
-- ledger rows; once a day this sends each reporter ONE digest of them.
-- The function re-checks verification, unsubscribe, the project gate and the
-- provider before sending, and leaves rows deferred when email is not
-- configured (RESEND_API_KEY / RESEND_FROM_EMAIL unset).
--
-- Verify after apply:
--   select jobname, schedule from cron.job where jobname = 'mushi-reporter-digest';  -- 1 row, '17 9 * * *'
-- and, after the first run, read net._http_response for a 200 from
-- reporter-notify-fanout (a PL/pgSQL or auth error only shows when it runs).
-- ============================================================================

do $$
begin
  perform cron.unschedule(jobname)
     from cron.job
    where jobname = 'mushi-reporter-digest';

  perform cron.schedule(
    'mushi-reporter-digest',
    '17 9 * * *',
    $cron$
      select mushi.edge_function_post(
        'reporter-notify-fanout',
        '{"digest":true,"trigger":"cron"}'::jsonb
      );
    $cron$
  );
end $$;

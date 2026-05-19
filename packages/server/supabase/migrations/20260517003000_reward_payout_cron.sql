-- Migration: reward_payout_cron
-- PURPOSE: P2 rewards — schedule the monthly payout aggregator cron.
--   Runs on the 1st of each month at 09:00 UTC.
--   Calls the reward-payout-aggregator edge function (service_role auth).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Build the function URL from the project ref env var (set by Supabase automatically)
    -- The cron schedule: monthly on the 1st at 09:00 UTC
    PERFORM cron.schedule(
      'mushi-reward-payout-aggregator',
      '0 9 1 * *',
      $sql$
        SELECT net.http_post(
          url := current_setting('app.supabase_url', true) || '/functions/v1/reward-payout-aggregator',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || current_setting('app.service_role_key', true),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb
        );
      $sql$
    );
  END IF;
END;
$$;

COMMENT ON EXTENSION pg_cron IS
  'pg_cron: Scheduled job — mushi-reward-payout-aggregator runs monthly (1st at 09:00 UTC) to process pending Stripe Connect payouts for reward tier achievers.';

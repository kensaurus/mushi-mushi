-- FILE: 20260510030000_schedule_usage_aggregator_cron.sql
-- PURPOSE: Schedule the missing `usage-aggregator` Edge Function cron.
--
-- The 20260418001800_billing.sql migration added the
-- `usage-aggregator` Edge Function and `billing_usage_unsynced_summary()`
-- helper, and its docstring claimed a cron would call it nightly — but the
-- actual `cron.schedule()` was never written. Result: every metered
-- `usage_events` row sat with `meter_synced_at IS NULL` forever, Stripe
-- never saw the meter events, and revenue from metered SKUs (overage,
-- successful fixes) silently went un-billed.
--
-- This migration:
--   1) Schedules `mushi-usage-aggregator-hourly` to run at minute :07
--      every hour (offset from other crons on :00 to spread load).
--   2) Uses the canonical `mushi_runtime_supabase_url()` /
--      `mushi_internal_auth_header()` helpers so it works on every
--      install (self-hosted, branch, prod) without env-var setup.
--   3) Is idempotent — safely re-runnable; unschedules a prior copy
--      before reinstalling.
--
-- Backfill: this migration does NOT replay missed events. The aggregator's
-- next tick will pick up everything where `meter_synced_at IS NULL` and
-- (occurred_at >= today - 30d). Older events stay unsynced by design;
-- if you need to bill them, reset `meter_synced_at` and rebackdate
-- `occurred_at` manually.
--
-- See also:
--   - packages/server/supabase/functions/usage-aggregator/index.ts
--   - packages/server/supabase/functions/_shared/stripe.ts (`recordMeterEvent`)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mushi-usage-aggregator-hourly') THEN
    PERFORM cron.unschedule('mushi-usage-aggregator-hourly');
  END IF;

  PERFORM cron.schedule(
    'mushi-usage-aggregator-hourly',
    '7 * * * *',
    $job$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/usage-aggregator',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', public.mushi_internal_auth_header()),
        body    := jsonb_build_object('trigger', 'cron'),
        timeout_milliseconds := 60000
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $job$
  );
END;
$cron$;

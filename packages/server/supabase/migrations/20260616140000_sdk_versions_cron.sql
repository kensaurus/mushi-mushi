-- Schedule a daily reconciliation of sdk_versions against the npm registry.
-- The `sdk-versions-cron` edge function reads each @mushi-mushi/* package
-- from the npm registry and upserts the latest stable version, so the catalog
-- stays fresh even if the release-workflow sync step is skipped.
--
-- The cron is intentionally parked at 02:30 UTC (low-traffic window, after
-- the nightly retention sweep at 03:00 UTC finishes its batch reads).

SELECT cron.schedule(
  'mushi-sdk-versions-reconcile-daily',
  '30 2 * * *',  -- 02:30 UTC daily
  $$
  SELECT net.http_post(
    url      := current_setting('app.supabase_edge_fn_url') || '/sdk-versions-cron',
    headers  := json_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
      'Content-Type',  'application/json'
    )::jsonb,
    body     := '{}'::jsonb
  );
  $$
) ON CONFLICT (jobname) DO UPDATE
  SET schedule = EXCLUDED.schedule;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

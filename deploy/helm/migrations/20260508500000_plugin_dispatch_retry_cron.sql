-- Register a pg_cron job that fires the plugin-dispatch-retry edge function
-- every minute. The worker pulls plugin_dispatch_log rows with status='pending'
-- whose next_retry_at has elapsed and replays them with the same HMAC signing
-- path. After attempt=5 the row is finalised as status='error'.
--
-- The job is idempotent: unschedule first (in case it was registered by a
-- previous deployment) then re-register.
--
-- One-minute cadence is intentional: the smallest backoff is 30s, so a
-- 60s tick may occasionally retry 30s late but never early. Smaller
-- cadences would burn quota with no user-visible improvement.
--
-- Auth: uses the canonical mushi.edge_function_post(fn_name, body) helper
-- which reads supabase_url + service_role_key from public.mushi_runtime_config.
-- The earlier raw `current_setting('app.settings.supabase_url', true)` pattern
-- silently returns NULL on this project (the GUC is never set), which made
-- net.http_post fail with `null value in column "url"` on every tick (60×/h).
-- The helper raises a clear error instead, and aligns this cron with the
-- other working jobs (mushi-repo-indexer-hourly, mushi-ci-sync-10m, …).
do $$
declare
  has_cron boolean;
begin
  select exists (select 1 from pg_namespace where nspname = 'cron') into has_cron;
  if not has_cron then
    raise notice 'pg_cron not installed; skipping plugin-dispatch-retry schedule';
    return;
  end if;

  perform cron.unschedule(jobname)
  from cron.job
  where jobname = 'mushi-plugin-dispatch-retry';

  perform cron.schedule(
    'mushi-plugin-dispatch-retry',
    '* * * * *',
    $cron$
      select mushi.edge_function_post(
        'plugin-dispatch-retry',
        '{}'::jsonb
      );
    $cron$
  );

  raise notice 'Registered mushi-plugin-dispatch-retry cron (* * * * *)';
end $$;

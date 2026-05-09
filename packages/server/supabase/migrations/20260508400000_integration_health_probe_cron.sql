-- Register a pg_cron job that fires the integration-health-probe edge function
-- every 15 minutes. The function sweeps all projects with configured integrations
-- and writes integration_health_history rows with source='cron', keeping the
-- /integrations page status chips fresh without requiring manual Test clicks.
--
-- The job is idempotent: unschedule first (in case it was registered by a
-- previous deployment) then re-register with the current URL pattern.
--
-- Auth: uses the canonical mushi.edge_function_post(fn_name, body) helper
-- which reads supabase_url + service_role_key from public.mushi_runtime_config.
-- The earlier raw `current_setting('app.settings.supabase_url', true)` pattern
-- silently returns NULL on this project (the GUC is never set), which made
-- net.http_post fail with `null value in column "url"` on every tick. The
-- helper raises a clear error instead, and aligns this cron with the other
-- working jobs (mushi-repo-indexer-hourly, mushi-ci-sync-10m, …).
do $$
declare
  has_cron boolean;
begin
  select exists (select 1 from pg_namespace where nspname = 'cron') into has_cron;
  if not has_cron then
    raise notice 'pg_cron not installed; skipping integration-health-probe schedule';
    return;
  end if;

  perform cron.unschedule(jobname)
  from cron.job
  where jobname = 'mushi-integration-health-probe';

  perform cron.schedule(
    'mushi-integration-health-probe',
    '*/15 * * * *',
    $cron$
      select mushi.edge_function_post(
        'integration-health-probe',
        '{}'::jsonb
      );
    $cron$
  );

  raise notice 'Registered mushi-integration-health-probe cron (*/15 * * * *)';
end $$;

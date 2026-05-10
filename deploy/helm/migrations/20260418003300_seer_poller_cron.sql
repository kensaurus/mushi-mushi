-- =============================================================================
-- PDCA full-sweep .4: Sentry Seer poller cron.
--
-- Triggers `sentry-seer-poll` every 15 minutes to pull Seer root-cause analyses
-- into matching reports. The function itself is gated by `sentry_seer_enabled`
-- on `project_settings`, so projects without a Sentry integration are no-ops.
-- =============================================================================

do $$
declare
  has_cron boolean;
begin
  select exists (select 1 from pg_namespace where nspname = 'cron') into has_cron;
  if not has_cron then
    raise notice 'pg_cron not installed; skipping seer-poller cron registration';
    return;
  end if;

  perform cron.unschedule(jobname)
    from cron.job
   where jobname = 'mushi-sentry-seer-poll-15m';

  perform cron.schedule(
    'mushi-sentry-seer-poll-15m',
    '*/15 * * * *',
    $cron$
      select net.http_post(
        url     := current_setting('app.settings.supabase_url', true) || '/functions/v1/sentry-seer-poll',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body    := '{}'::jsonb
      );
    $cron$
  );
end $$;

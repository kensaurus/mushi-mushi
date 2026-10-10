-- ============================================================================
-- 20261010171000_tremendous_worker_cron_repair
--
-- 20260523020000 scheduled tremendous-redemption-worker with
--   url  := (select value from mushi_runtime_config where key = 'edge_function_base_url') || ...
--   auth := 'Bearer ' || current_setting('app.service_role_key', true)
-- Neither is ever set (no migration seeds edge_function_base_url), so every
-- run posted to a NULL url and no gift-card order was ever sent.
-- 20260922000010 repaired the same pattern for recompute-tester-reputation
-- only. This moves the job onto mushi.cron_http_post(), which uses
-- mushi_runtime_supabase_url() + mushi_internal_auth_header() and logs the
-- call for the edge-call watchdog. The function already has
-- verify_jwt = false (config.toml), so the internal header reaches
-- requireServiceRoleAuth.
--
-- The job is left INACTIVE, like mushi-reward-payout-aggregator: a working
-- job sends real gift-card orders, and payouts have not launched (the
-- funding source is still the seed sentinel). Enabling it is the owner's
-- call. After setting TREMENDOUS_API_URL, TREMENDOUS_API_KEY and
-- mushi_runtime_config.tremendous_funding_source_id:
--   select cron.alter_job(jobid, active := true) from cron.job
--    where jobname = 'tremendous-redemption-worker';
-- ============================================================================

do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cron.schedule replaces a job of the same name, so installs that ran
    -- 20260523020000 get the repaired command rather than a second job.
    perform cron.schedule(
      'tremendous-redemption-worker',
      '* * * * *',
      $job$select mushi.cron_http_post('tremendous-redemption-worker', '{}'::jsonb);$job$
    );
    perform cron.alter_job(jobid, active := false)
       from cron.job
      where jobname = 'tremendous-redemption-worker';
  end if;
end;
$do$;

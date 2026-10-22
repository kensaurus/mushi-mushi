-- Cron → edge function calls stop timing out on slow DNS.
--
-- WHY (2026-10-22): about 1 in 10 cron calls (21–23 an hour) ended in
-- net._http_response with "Timeout of 5000 ms reached … (DNS time: 5002 ms)":
-- pg_net gave up while resolving the project host, so the call never reached
-- the function. agent-pr-review ran 9 times in two hours instead of 12, which
-- slowed the review queue. Every caller used pg_net's 5 s default:
--   - mushi.cron_http_post (22 jobs) defaulted timeout_ms to 5000;
--   - five jobs added in Oct 2026 called net.http_post directly with no
--     timeout and were not logged in mushi.edge_function_calls.
--
-- WHAT: the helper waits up to 30 s (the function keeps running either way;
-- this only stops slow DNS from dropping the call), and the five direct jobs
-- go through the helper on the same schedules, so they get the timeout and
-- the call log too. Idempotent.

CREATE OR REPLACE FUNCTION mushi.cron_http_post(fn_name text, body jsonb DEFAULT '{}'::jsonb, timeout_ms integer DEFAULT 30000)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'net'
AS $function$
declare
  v_url  text := public.mushi_runtime_supabase_url();
  v_auth text := public.mushi_internal_auth_header();
  v_id   bigint;
begin
  if v_url is null or v_auth is null then
    return null;
  end if;

  select net.http_post(
    url                  := v_url || '/functions/v1/' || fn_name,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', v_auth),
    body                 := body,
    timeout_milliseconds := timeout_ms
  ) into v_id;

  insert into mushi.edge_function_calls (request_id, fn_name)
  values (v_id, fn_name)
  on conflict (request_id) do nothing;

  return v_id;
end;
$function$;

DO $$
DECLARE
  v_job record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping cron rewrites';
    RETURN;
  END IF;

  FOR v_job IN
    SELECT * FROM (VALUES
      ('mushi-agent-pr-review',   '3-53/10 * * * *', 'agent-pr-review'),
      ('mushi-ci-jobs-collector', '2-52/10 * * * *', 'ci-jobs-collector'),
      ('mushi-review-followup',   '6-56/10 * * * *', 'review-followup'),
      ('mushi-site-watch-poll',   '14 * * * *',      'site-watch-poll'),
      ('mushi-spend-down',        '8-58/10 * * * *', 'spend-down-worker')
    ) AS t(jobname, schedule, fn)
  LOOP
    -- Only jobs that exist and still call net.http_post directly; a job a
    -- later migration already rewrote is left alone.
    IF EXISTS (
      SELECT 1 FROM cron.job
       WHERE jobname = v_job.jobname
         AND command ILIKE '%net.http_post(%'
    ) THEN
      PERFORM cron.schedule(
        v_job.jobname,
        v_job.schedule,
        format($cmd$select mushi.cron_http_post(%L, jsonb_build_object('trigger', 'cron'));$cmd$, v_job.fn)
      );
    END IF;
  END LOOP;
END $$;

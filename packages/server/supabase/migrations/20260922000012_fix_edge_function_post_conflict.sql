-- ============================================================================
-- 20260922000012_fix_edge_function_post_conflict
--
-- 20260922000010 added call logging to mushi.edge_function_post with
-- `ON CONFLICT (request_id)`, but the function also declares a local variable
-- named request_id, so PL/pgSQL rejected the statement as ambiguous. The error
-- rolled back the pg_net enqueue too: every job using the helper
-- (plugin-dispatch-retry, qa-story-runner, status-reconciler, ci-sync,
-- integration-health-probe, anomaly-detector, …) made no call from 05:55 to
-- this fix on 2026-09-22. Naming the conflict target by constraint removes
-- the ambiguity; nothing else changes.
-- ============================================================================

create or replace function mushi.edge_function_post(fn_name text, body jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'net'
as $function$
DECLARE
  v_url text;
  v_key text;
  request_id bigint;
BEGIN
  SELECT value INTO v_url FROM public.mushi_runtime_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public.mushi_runtime_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'mushi.edge_function_post: mushi_runtime_config.supabase_url missing';
  END IF;
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'mushi.edge_function_post: mushi_runtime_config.service_role_key missing (mirror MUSHI_INTERNAL_CALLER_SECRET here)';
  END IF;
  SELECT net.http_post(
    url := v_url || '/functions/v1/' || fn_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'X-Mushi-Internal', 'cron'
    ),
    body := body,
    timeout_milliseconds := 300000
  ) INTO request_id;

  INSERT INTO mushi.edge_function_calls (request_id, fn_name)
  VALUES (request_id, fn_name)
  ON CONFLICT ON CONSTRAINT edge_function_calls_pkey DO NOTHING;

  RETURN request_id;
END;
$function$;

revoke all on function mushi.edge_function_post(text, jsonb) from public, anon, authenticated;

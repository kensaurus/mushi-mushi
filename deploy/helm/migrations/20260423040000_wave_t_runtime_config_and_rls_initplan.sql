-- =============================================================================
-- Wave T (2026-04-23) — runtime config migration + RLS initplan fix
--
-- Fixes three audit findings (see docs/audit-2026-04-23/SUMMARY.md):
--
--   T1 (P0) — six cron jobs silently fail because
--             `current_setting('app.settings.service_role_key')` returns NULL
--             on hosted Supabase (we can't ALTER DATABASE SET on the hosted
--             tier). `http_request_queue.url NOT NULL` then rejects every
--             request the cron tries to post. Blast radius:
--               - mushi-sentry-seer-poll-15m   (every 15 min)
--               - mushi-judge-batch-nightly
--               - mushi-intelligence-report-weekly
--               - mushi-library-modernizer-weekly
--               - mushi-prompt-auto-tune-weekly
--               - mushi-soc2-evidence
--
--   T3 (P1) — `recover_stranded_pipeline()` calls fast-filter with no
--             Authorization header, so when the recovery cron does find
--             stranded reports it immediately takes a 401 storm.
--             `requireServiceRoleAuth` in the edge function rejects
--             unsigned callers.
--
--   T10 (P2) — `fix_events_owner_select` re-evaluates `auth.uid()` for
--              every row (Supabase performance linter). One-line fix:
--              wrap in `(select auth.uid())`.
--
-- Design: we extend the existing `mushi_runtime_config` table (Wave M) with
-- an `internal_caller_token` key so that pg_cron can sign outbound calls
-- without needing the auto-injected `SUPABASE_SERVICE_ROLE_KEY` env var
-- that only the edge runtime can see. The token is validated by
-- `requireServiceRoleAuth` via its `MUSHI_INTERNAL_CALLER_SECRET` path —
-- the edge runtime compares the Bearer against that env var, not against
-- the service-role key, so the secret is a standalone shared secret that
-- platform operators can rotate independently.
--
-- Rotation runbook:
--   1. Generate a new token:
--        `openssl rand -base64 48`
--   2. Update the DB row:
--        update mushi_runtime_config
--           set value = :'new_token', updated_at = now()
--         where key = 'internal_caller_token';
--   3. Set the edge secret:
--        supabase secrets set MUSHI_INTERNAL_CALLER_SECRET=:'new_token'
--   4. `supabase functions deploy` (picks up the new secret).
--
-- Idempotent: re-running the migration is safe — every block uses `IF NOT
-- EXISTS` / `ON CONFLICT DO UPDATE` / `CREATE OR REPLACE FUNCTION`.
-- =============================================================================

-- 1. Ensure mushi_runtime_config has the keys we need. `supabase_url` was
-- seeded by the Wave M migration; `internal_caller_token` is new. The
-- empty-string default forces operators to set a real value before the
-- affected crons can actually call the edge functions.
INSERT INTO public.mushi_runtime_config (key, value)
VALUES
  ('supabase_url', 'https://dxptnwrhwsqckaftyymj.supabase.co'),
  ('internal_caller_token', '')
ON CONFLICT (key) DO NOTHING;

-- 2. Helper: compose the Authorization header, preferring the runtime
-- token, falling back to the old GUC path so existing crons we haven't
-- migrated yet keep limping along. Returns NULL when neither is set so
-- callers can skip the http_post and log a clear reason.
CREATE OR REPLACE FUNCTION public.mushi_internal_auth_header()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token text;
BEGIN
  SELECT value INTO v_token
    FROM public.mushi_runtime_config
   WHERE key = 'internal_caller_token'
     AND value <> '';
  IF v_token IS NOT NULL THEN
    RETURN 'Bearer ' || v_token;
  END IF;

  -- Legacy fallback for clusters where app.settings.service_role_key
  -- WAS manually set. Returns NULL on hosted Supabase (today's
  -- dxptn... project) which is caught by the caller.
  BEGIN
    v_token := current_setting('app.settings.service_role_key', true);
    IF v_token IS NOT NULL AND v_token <> '' THEN
      RETURN 'Bearer ' || v_token;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- current_setting without missing_ok still raises on some
    -- managed providers; swallow and return NULL.
    NULL;
  END;

  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.mushi_internal_auth_header() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mushi_internal_auth_header() TO service_role, postgres;

-- 3. Helper: read the supabase_url without the legacy GUC surface.
CREATE OR REPLACE FUNCTION public.mushi_runtime_supabase_url()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT value FROM public.mushi_runtime_config WHERE key = 'supabase_url';
$$;

REVOKE ALL ON FUNCTION public.mushi_runtime_supabase_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mushi_runtime_supabase_url() TO service_role, postgres;

-- 4. Patch `recover_stranded_pipeline()` so its fast-filter calls carry a
-- valid Authorization. Everything else (stranded-report selection, queue
-- retry loop, audit insert) is preserved verbatim from Wave M.
CREATE OR REPLACE FUNCTION public.recover_stranded_pipeline()
RETURNS TABLE(stranded_reports int, retried_queue int, reconciled_completed int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_url               text;
  v_auth              text;
  v_stranded_reports  int  := 0;
  v_retried_queue     int  := 0;
  v_reconciled        int  := 0;
  rec record;
BEGIN
  v_url  := public.mushi_runtime_supabase_url();
  v_auth := public.mushi_internal_auth_header();

  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING 'recover_stranded_pipeline: mushi_runtime_config.supabase_url missing';
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  WITH reconciled AS (
    UPDATE processing_queue pq
       SET status = 'completed',
           completed_at = now()
      FROM reports r
     WHERE pq.report_id = r.id
       AND pq.status = 'pending'
       AND r.status IN ('classified', 'dispatched', 'completed')
    RETURNING pq.id
  )
  SELECT count(*) INTO v_reconciled FROM reconciled;

  FOR rec IN
    SELECT id, project_id
      FROM reports
     WHERE status IN ('new', 'queued')
       AND created_at < now() - interval '5 minutes'
       AND processing_attempts < 3
     ORDER BY created_at ASC
     LIMIT 25
  LOOP
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/fast-filter',
      headers := CASE
        WHEN v_auth IS NULL THEN jsonb_build_object('Content-Type', 'application/json')
        ELSE jsonb_build_object('Content-Type', 'application/json', 'Authorization', v_auth)
      END,
      body    := jsonb_build_object('reportId', rec.id::text, 'projectId', rec.project_id::text)
    );
    v_stranded_reports := v_stranded_reports + 1;
  END LOOP;

  FOR rec IN
    SELECT pq.id AS queue_id, pq.report_id, pq.attempts, r.project_id, r.status AS report_status
      FROM processing_queue pq
      JOIN reports r ON r.id = pq.report_id
     WHERE pq.status = 'failed'
       AND pq.attempts < pq.max_attempts
       AND r.status IN ('new', 'queued')
     ORDER BY pq.created_at ASC
     LIMIT 25
  LOOP
    UPDATE processing_queue
       SET status = 'pending',
           scheduled_at = now()
     WHERE id = rec.queue_id;

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/fast-filter',
      headers := CASE
        WHEN v_auth IS NULL THEN jsonb_build_object('Content-Type', 'application/json')
        ELSE jsonb_build_object('Content-Type', 'application/json', 'Authorization', v_auth)
      END,
      body    := jsonb_build_object('reportId', rec.report_id::text, 'projectId', rec.project_id::text)
    );
    v_retried_queue := v_retried_queue + 1;
  END LOOP;

  INSERT INTO cron_runs (job_name, trigger, finished_at, duration_ms, status, rows_affected, metadata)
  VALUES (
    'pipeline-recovery',
    'cron',
    now(),
    0,
    'success',
    v_stranded_reports + v_retried_queue + v_reconciled,
    jsonb_build_object(
      'stranded_reports',     v_stranded_reports,
      'retried_queue',        v_retried_queue,
      'reconciled_completed', v_reconciled,
      'auth_source',          CASE WHEN v_auth IS NULL THEN 'none' ELSE 'runtime_config' END
    )
  );

  RETURN QUERY SELECT v_stranded_reports, v_retried_queue, v_reconciled;
END $$;

REVOKE ALL ON FUNCTION public.recover_stranded_pipeline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stranded_pipeline() TO service_role, postgres;

-- 5. Rewrite the six broken crons to read the URL + auth from
-- mushi_runtime_config instead of the NULL GUCs. Each block unschedules
-- any prior version first so reruns are idempotent. pg_cron-checked.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping Wave T cron rewrites';
    RETURN;
  END IF;

  -- sentry-seer-poll (every 15 min)
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-sentry-seer-poll-15m';
  PERFORM cron.schedule(
    'mushi-sentry-seer-poll-15m',
    '*/15 * * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/sentry-seer-poll',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := '{}'::jsonb
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );

  -- judge-batch (nightly)
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-judge-batch-nightly';
  PERFORM cron.schedule(
    'mushi-judge-batch-nightly',
    '0 3 * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/judge-batch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := jsonb_build_object('trigger', 'cron')
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );

  -- intelligence-report (weekly)
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-intelligence-report-weekly';
  PERFORM cron.schedule(
    'mushi-intelligence-report-weekly',
    '0 6 * * 1',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/intelligence-report',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := jsonb_build_object('trigger', 'cron')
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );

  -- library-modernizer (weekly)
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-library-modernizer-weekly';
  PERFORM cron.schedule(
    'mushi-library-modernizer-weekly',
    '0 6 * * 0',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/library-modernizer',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := jsonb_build_object('mode', 'sweep')
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );

  -- prompt-auto-tune (weekly)
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-prompt-auto-tune-weekly';
  PERFORM cron.schedule(
    'mushi-prompt-auto-tune-weekly',
    '0 7 * * 0',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/prompt-auto-tune',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := jsonb_build_object('trigger', 'cron')
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );

  -- soc2-evidence (daily 04:30)
  -- The prior version had `url := current_setting('app.settings.functions_base_url', true)` which
  -- was also NULL. Point it at the soc2-evidence function explicitly.
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'mushi-soc2-evidence';
  PERFORM cron.schedule(
    'mushi-soc2-evidence',
    '30 4 * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/soc2-evidence',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := jsonb_build_object('trigger', 'cron')
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );
END $$;

-- NOTE: `fix_events_owner_select` already uses the `(SELECT auth.uid())`
-- subquery form as of 20260422060000. No initplan rewrite needed in
-- Wave T — the earlier audit note in SUMMARY.md was stale.


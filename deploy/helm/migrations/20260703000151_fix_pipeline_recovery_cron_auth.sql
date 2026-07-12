-- =============================================================================
-- Fix pipeline-recovery cron 401 storm (red-team #11 follow-up)
--
-- Root cause: recover_stranded_pipeline() posts to fast-filter without auth
-- when mushi_runtime_config.internal_caller_token is empty. fast-filter's
-- requireServiceRoleAuth rejects unsigned callers with 401 every 5 minutes.
--
-- Fix:
--   1. Skip net.http_post when mushi_internal_auth_header() is NULL (no 401 storm).
--   2. Log auth_source='none' in cron_runs metadata so operators can see the gap.
--   3. Document the operator action: set internal_caller_token + deploy
--      MUSHI_INTERNAL_CALLER_SECRET (see Wave T migration comments).
--
-- Idempotent: CREATE OR REPLACE FUNCTION only.
-- =============================================================================

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

  IF v_auth IS NULL THEN
    RAISE WARNING 'recover_stranded_pipeline: mushi_internal_auth_header() missing — set mushi_runtime_config.internal_caller_token and MUSHI_INTERNAL_CALLER_SECRET';
    INSERT INTO cron_runs (job_name, trigger, finished_at, duration_ms, status, rows_affected, metadata)
    VALUES (
      'pipeline-recovery',
      'cron',
      now(),
      0,
      'skipped',
      0,
      jsonb_build_object('auth_source', 'none', 'reason', 'internal_caller_token not configured')
    );
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
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', v_auth
      ),
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
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', v_auth
      ),
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
      'auth_source',          'runtime_config'
    )
  );

  RETURN QUERY SELECT v_stranded_reports, v_retried_queue, v_reconciled;
END $$;

REVOKE ALL ON FUNCTION public.recover_stranded_pipeline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stranded_pipeline() TO service_role, postgres;

-- =============================================================================
-- Reconcile fix (code-review follow-up to 20260707092000):
--
-- The reconcile pass counted a missing net._http_response row (LEFT JOIN →
-- status_code IS NULL) as a FAILURE. A fast-filter call still in flight when
-- the next run fires — or a response row already purged by pg_net's TTL —
-- false-flagged the previous run as 'degraded' and produced doctor noise.
--
-- Now: failed = a response that actually landed with a non-2xx status OR a
-- transport error (error_msg); still-missing rows are reported separately as
-- responses_pending and do not degrade the run.
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
  v_request_ids       bigint[] := '{}';
  v_req_id            bigint;
  v_prev_run          record;
  v_resp_total        int;
  v_resp_failed       int;
  v_resp_pending      int;
  rec record;
BEGIN
  v_url  := public.mushi_runtime_supabase_url();
  v_auth := public.mushi_internal_auth_header();

  -- ── Reconcile the previous run's fire-and-forget posts ────────────────
  -- pg_net responses land asynchronously, so a run can only judge its
  -- predecessor. 'success' + request_ids + not yet reconciled = candidate.
  SELECT id, metadata INTO v_prev_run
    FROM cron_runs
   WHERE job_name = 'pipeline-recovery'
     AND status IN ('success', 'degraded')
     AND metadata ? 'request_ids'
     AND NOT (metadata ? 'reconciled')
   ORDER BY finished_at DESC
   LIMIT 1;

  IF v_prev_run.id IS NOT NULL THEN
    SELECT count(*),
           count(*) FILTER (WHERE (r.status_code IS NOT NULL AND (r.status_code < 200 OR r.status_code >= 300))
                               OR r.error_msg IS NOT NULL),
           count(*) FILTER (WHERE r.id IS NULL)
      INTO v_resp_total, v_resp_failed, v_resp_pending
      FROM jsonb_array_elements_text(v_prev_run.metadata->'request_ids') AS ids(id)
      LEFT JOIN net._http_response r ON r.id = ids.id::bigint;

    UPDATE cron_runs
       SET status   = CASE WHEN v_resp_failed > 0 THEN 'degraded' ELSE status END,
           metadata = metadata || jsonb_build_object(
             'reconciled', true,
             'responses_total', v_resp_total,
             'responses_failed', v_resp_failed,
             'responses_pending', v_resp_pending
           )
     WHERE id = v_prev_run.id;
  END IF;

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
    -- Count the recovery attempt here: fast-filter only increments on
    -- successful writeback, which let permanently-failing reports loop
    -- through recovery forever.
    UPDATE reports
       SET processing_attempts = processing_attempts + 1
     WHERE id = rec.id;

    SELECT net.http_post(
      url     := v_url || '/functions/v1/fast-filter',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', v_auth
      ),
      body    := jsonb_build_object('reportId', rec.id::text, 'projectId', rec.project_id::text)
    ) INTO v_req_id;
    v_request_ids := v_request_ids || v_req_id;
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

    SELECT net.http_post(
      url     := v_url || '/functions/v1/fast-filter',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', v_auth
      ),
      body    := jsonb_build_object('reportId', rec.report_id::text, 'projectId', rec.project_id::text)
    ) INTO v_req_id;
    v_request_ids := v_request_ids || v_req_id;
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
      'auth_source',          'runtime_config',
      'request_ids',          to_jsonb(v_request_ids)
    )
  );

  RETURN QUERY SELECT v_stranded_reports, v_retried_queue, v_reconciled;
END $$;

REVOKE ALL ON FUNCTION public.recover_stranded_pipeline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stranded_pipeline() TO service_role, postgres;

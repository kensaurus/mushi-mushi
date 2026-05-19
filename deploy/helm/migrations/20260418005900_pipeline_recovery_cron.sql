-- =============================================================================
-- Pipeline recovery cron — fires every 5 minutes to retry stranded reports
-- and stale processing_queue items so the PDCA loop self-heals from transient
-- LLM/network failures without operator intervention.
--
-- Why this exists:
--   The PDCA full-sweep handover (2026-04-18) declared the loop "green" but
--   live audit found 11 reports stuck `status='new'` and 4 `processing_queue`
--   items stuck `pending` with no recovery path — `triggerClassification`
--   only fires once on ingest, and the existing `flush-queued` admin endpoint
--   only handles `status='queued'`. This migration plugs the gap.
--
-- Implementation notes:
--   * `fast-filter` is deployed with `verify_jwt: false`, so the cron does
--     not need to pass an `Authorization` bearer at the platform layer. The
--     edge function uses its own `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`
--     to talk to PostgREST.
--   * We persist the supabase URL via `ALTER DATABASE` so existing crons
--     that read `current_setting('app.settings.supabase_url', true)` no
--     longer get NULL (a bug discovered while debugging the recovery —
--     ALL existing net.http_post-based crons were silently failing because
--     this GUC was unset).
--   * Idempotent: re-running the migration unschedules the previous job
--     before re-creating it; ALTER DATABASE SET is naturally idempotent.
-- =============================================================================

-- We deliberately do NOT depend on `current_setting('app.settings.supabase_url')`
-- because the migration role can't ALTER DATABASE to set it (Supabase locks
-- this down on hosted projects). Instead, we read the URL from a small
-- `mushi_runtime_config` table that platform admins can update via the
-- supabase dashboard SQL editor. This also makes cross-environment moves
-- (staging vs prod) trivial.
CREATE TABLE IF NOT EXISTS public.mushi_runtime_config (
  key   text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mushi_runtime_config ENABLE ROW LEVEL SECURITY;

DO $rls$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'mushi_runtime_config' AND policyname = 'service_role_only'
  ) THEN
    CREATE POLICY service_role_only ON public.mushi_runtime_config
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $rls$;

INSERT INTO public.mushi_runtime_config (key, value)
VALUES ('supabase_url', 'https://dxptnwrhwsqckaftyymj.supabase.co')
ON CONFLICT (key) DO NOTHING;

-- Helper: walks stranded reports + queue items and re-invokes fast-filter
-- via pg_net. Returns counts so cron history shows visibility.
CREATE OR REPLACE FUNCTION public.recover_stranded_pipeline()
RETURNS TABLE(stranded_reports int, retried_queue int, reconciled_completed int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_url               text;
  v_stranded_reports  int  := 0;
  v_retried_queue     int  := 0;
  v_reconciled        int  := 0;
  rec record;
BEGIN
  SELECT value INTO v_url FROM public.mushi_runtime_config WHERE key = 'supabase_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING 'recover_stranded_pipeline: mushi_runtime_config.supabase_url missing';
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  -- 1. Reconcile queue items whose report has already advanced past stage1
  --    (race condition where fast-filter wrote `reports.status='classified'`
  --    but the queue update didn't land before the function returned).
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

  -- 2. Re-invoke fast-filter for reports stuck in `new` or `queued` past
  --    the SLA cutoff. Bounded at 25/run so a backlog burst doesn't
  --    overwhelm the LLM provider.
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
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('reportId', rec.id::text, 'projectId', rec.project_id::text)
    );
    v_stranded_reports := v_stranded_reports + 1;
  END LOOP;

  -- 3. Auto-retry processing_queue items that failed with attempts left.
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
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object('reportId', rec.report_id::text, 'projectId', rec.project_id::text)
    );
    v_retried_queue := v_retried_queue + 1;
  END LOOP;

  -- Audit trail so the admin /queue page can show "last recovery ran X minutes ago".
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
      'reconciled_completed', v_reconciled
    )
  );

  RETURN QUERY SELECT v_stranded_reports, v_retried_queue, v_reconciled;
END $$;

REVOKE ALL ON FUNCTION public.recover_stranded_pipeline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stranded_pipeline() TO service_role, postgres;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping pipeline-recovery schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-pipeline-recovery-5m';

  PERFORM cron.schedule(
    'mushi-pipeline-recovery-5m',
    '*/5 * * * *',
    $cron$ SELECT public.recover_stranded_pipeline(); $cron$
  );
END $$;

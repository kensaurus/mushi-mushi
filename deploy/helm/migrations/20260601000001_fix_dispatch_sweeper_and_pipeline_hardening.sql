-- =============================================================================
-- Migration: fix_dispatch_sweeper_and_pipeline_hardening
-- =============================================================================
-- Addresses mushi production-hardening plan items:
--
--  1. completed_no_pr status: add to fix_dispatch_jobs status check constraint
--     so the fix-worker can distinguish "generated but blocked" from "completed".
--  2. Fix-dispatch sweeper: pg_cron function that drains queued sibling
--     fix_dispatch_jobs (inserted by fix-worker fan-out for multi-repo) by
--     invoking the fix-worker edge function per child. Advisory-lock guarded
--     so at most one sweeper run is active at any moment.
--  3. Stranded-job alert function: emits a WARNING log row when queued jobs
--     are older than 10 minutes so monitoring/log drain can surface them.
--  4. Dispatch pipeline_runs table for per-run observability.
-- =============================================================================

-- ── 1. completed_no_pr status ──────────────────────────────────────────────

-- The fix_dispatch_jobs table uses a check constraint on status. We need to
-- allow the new completed_no_pr value without breaking existing valid statuses.
-- Drop the old constraint if it exists, then re-create with the new set.
ALTER TABLE public.fix_dispatch_jobs
  DROP CONSTRAINT IF EXISTS fix_dispatch_jobs_status_check;

ALTER TABLE public.fix_dispatch_jobs
  ADD CONSTRAINT fix_dispatch_jobs_status_check
    CHECK (status IN (
      'queued', 'running', 'completed', 'completed_no_pr',
      'failed', 'cancelled', 'skipped', 'skipped_no_sandbox'
    ));

-- ── 2. pipeline_runs observability table ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pipeline_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_name      text        NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  rows_in       integer     NOT NULL DEFAULT 0,
  rows_out      integer     NOT NULL DEFAULT 0,
  rows_blocked  integer     NOT NULL DEFAULT 0,
  error         text,
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_name_started
  ON public.pipeline_runs (run_name, started_at DESC);

ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pipeline_runs_service_role ON public.pipeline_runs
  USING (false);

COMMENT ON TABLE public.pipeline_runs IS
  'Per-run observability for background sweepers (fix-dispatch sweeper, '
  'blast-radius refresh, etc.). Each run emits one row with rows_in / rows_out '
  '/ rows_blocked counts so drift / stall is visible in Supabase Logs.';

-- ── 3. fix_dispatch_sweeper function ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fix_dispatch_sweeper()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_key  bigint := hashtext('fix_dispatch_sweeper')::bigint;
  v_got_lock  boolean;
  v_api_url   text;
  v_service_key text;
  v_job       record;
  v_rows_in   integer := 0;
  v_rows_out  integer := 0;
  v_rows_blocked integer := 0;
  v_run_id    uuid := gen_random_uuid();
BEGIN
  -- Advisory lock: only one sweeper run at a time. The lock is scoped to the
  -- transaction so it is released automatically at function end.
  v_got_lock := pg_try_advisory_xact_lock(v_lock_key);
  IF NOT v_got_lock THEN
    RAISE NOTICE 'fix_dispatch_sweeper: another instance is running — skipping';
    RETURN;
  END IF;

  -- Resolve the edge-function base URL and service key from pg_settings.
  -- These must be set via `ALTER DATABASE SET mushi.api_url = '...'` and
  -- `ALTER DATABASE SET mushi.service_role_key = '...'` (done in bootstrap
  -- or as a one-time admin operation).
  BEGIN
    v_api_url     := current_setting('mushi.api_url', true);
    v_service_key := current_setting('mushi.service_role_key', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fix_dispatch_sweeper: mushi.api_url / mushi.service_role_key not set — cannot invoke fix-worker';
    RETURN;
  END;

  IF v_api_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'fix_dispatch_sweeper: missing config — skipping';
    RETURN;
  END IF;

  -- Drain queued sibling fix_dispatch_jobs (coordination_id is set on sibling
  -- jobs inserted by fix-worker fan-out). Limit to 20 per run to avoid DB
  -- timeouts; remaining jobs are picked up on the next pg_cron tick.
  FOR v_job IN
    SELECT id, project_id, report_id, coordination_id, dispatch_metadata
    FROM   public.fix_dispatch_jobs
    WHERE  status = 'queued'
      AND  coordination_id IS NOT NULL  -- only sweeper-eligible sibling jobs
      AND  created_at < now() - interval '30 seconds'  -- small grace window
    ORDER  BY created_at ASC
    LIMIT  20
    FOR UPDATE SKIP LOCKED
  LOOP
    v_rows_in := v_rows_in + 1;

    -- Mark as running to avoid double-dispatch on slow pg_cron ticks
    UPDATE public.fix_dispatch_jobs
    SET    status = 'running'
    WHERE  id = v_job.id;

    -- Invoke fix-worker via pg_net (Supabase net extension). Non-fatal if
    -- pg_net is unavailable — the UPDATE above is already committed.
    BEGIN
      PERFORM net.http_post(
        url     := v_api_url || '/functions/v1/fix-worker',
        headers := jsonb_build_object(
          'Content-Type',   'application/json',
          'Authorization',  'Bearer ' || v_service_key
        ),
        body    := jsonb_build_object(
          'dispatchId',        v_job.id::text,
          'projectId',         v_job.project_id::text,
          'reportId',          v_job.report_id::text,
          'coordinationId',    v_job.coordination_id::text,
          'dispatchMetadata',  COALESCE(v_job.dispatch_metadata, '{}'::jsonb)
        )
      );
      v_rows_out := v_rows_out + 1;
    EXCEPTION WHEN OTHERS THEN
      -- pg_net not available or HTTP failed — revert to queued so the next
      -- sweeper tick retries.
      UPDATE public.fix_dispatch_jobs
      SET    status = 'queued'
      WHERE  id = v_job.id;
      v_rows_blocked := v_rows_blocked + 1;
      RAISE WARNING 'fix_dispatch_sweeper: failed to invoke fix-worker for job % — %', v_job.id, SQLERRM;
    END;
  END LOOP;

  -- Stranded-job alert: warn when old queued non-sibling jobs exist
  -- (orphans from a deploy gap or failed classify-report). These need
  -- human inspection — the sweeper only handles sibling fan-out.
  DECLARE
    v_stranded integer;
  BEGIN
    SELECT COUNT(*) INTO v_stranded
    FROM   public.fix_dispatch_jobs
    WHERE  status = 'queued'
      AND  coordination_id IS NULL
      AND  created_at < now() - interval '10 minutes';

    IF v_stranded > 0 THEN
      RAISE WARNING 'fix_dispatch_sweeper: % stranded queued job(s) older than 10 min — check fix_dispatch_jobs', v_stranded;
    END IF;
  END;

  -- Emit pipeline_runs row for observability
  INSERT INTO public.pipeline_runs (id, run_name, rows_in, rows_out, rows_blocked, finished_at)
  VALUES (v_run_id, 'fix_dispatch_sweeper', v_rows_in, v_rows_out, v_rows_blocked, now());

  RAISE NOTICE 'fix_dispatch_sweeper: done — in=%, out=%, blocked=%', v_rows_in, v_rows_out, v_rows_blocked;
END;
$$;

COMMENT ON FUNCTION public.fix_dispatch_sweeper() IS
  'pg_cron worker: drains queued sibling fix_dispatch_jobs (fan-out from '
  'multi-repo fix-worker runs). Invokes fix-worker edge function per child via '
  'pg_net. Advisory-lock guarded. Emits pipeline_runs row per execution.';

-- ── 4. Schedule the sweeper every minute ───────────────────────────────────

-- cron.schedule is idempotent on the same job name — safe to re-run.
SELECT cron.schedule(
  'fix-dispatch-sweeper',
  '* * * * *',
  $$SELECT public.fix_dispatch_sweeper();$$
) WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'fix-dispatch-sweeper'
);

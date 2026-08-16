-- =============================================================================
-- Migration: fix_dispatch_sweeper_runtime_config
-- =============================================================================
-- The 20260724000001 sweeper guards on `current_setting('mushi.api_url')` /
-- `current_setting('mushi.service_role_key')` — settings that can only be
-- applied with `ALTER DATABASE ... SET`, which requires superuser on hosted
-- Supabase and was therefore NEVER set in production. Result (triage audit
-- 2026-08-16): cron.job_run_details shows ~109k "succeeded" runs, all exiting
-- at the config guard, with zero pipeline_runs rows — every lost
-- fire-and-forget fix-worker invoke was unrecoverable.
--
-- Fix, matching the pattern every other cron job in this repo already uses
-- (20260602135000_pdca_qa_improve_cron_runtime_helpers.sql):
--   * Resolve config as GUC override → public.mushi_runtime_supabase_url()
--     + public.mushi_internal_auth_header() fallback.
--   * When still unconfigured, INSERT a pipeline_runs row named
--     'fix_dispatch_sweeper_unconfigured' before returning — silence is how
--     the dead sweeper hid for four weeks; skips must leave a trace.
-- Everything else (advisory lock, 30s/2min grace windows, atomic claim
-- semantics, stranded-job warning) is unchanged.
-- =============================================================================

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
  v_auth_header text;
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

  -- Config: GUC override first (self-hosted deployments with superuser can
  -- still `ALTER DATABASE SET mushi.api_url/...`), then the runtime helpers
  -- used by every other pg_cron job here. `'Bearer ' || NULL` is NULL, so the
  -- NULLIF/COALESCE chain falls through cleanly when the GUC is unset.
  BEGIN
    v_api_url := COALESCE(
      current_setting('mushi.api_url', true),
      public.mushi_runtime_supabase_url()
    );
    v_auth_header := COALESCE(
      'Bearer ' || current_setting('mushi.service_role_key', true),
      public.mushi_internal_auth_header()
    );
  EXCEPTION WHEN OTHERS THEN
    v_api_url := NULL;
    v_auth_header := NULL;
  END;

  IF v_api_url IS NULL OR v_auth_header IS NULL THEN
    INSERT INTO public.pipeline_runs (id, run_name, rows_in, rows_out, rows_blocked, finished_at)
    VALUES (v_run_id, 'fix_dispatch_sweeper_unconfigured', 0, 0, 0, now());
    RAISE WARNING 'fix_dispatch_sweeper: no api url / auth available (GUC unset and runtime config not seeded) — cannot invoke fix-worker';
    RETURN;
  END IF;

  -- Drain queued fix_dispatch_jobs:
  --   - sibling fan-out jobs (coordination_id set by fix-worker multi-repo
  --     fan-out) after a 30-second grace window, as before;
  --   - primary dispatches (coordination_id NULL — inserted by dispatch.ts,
  --     whose direct fire-and-forget invoke may have been lost) after a
  --     2-minute grace window, so the normal direct-invoke path always wins
  --     when it works.
  -- Limit to 20 per run to avoid DB timeouts; remaining jobs are picked up on
  -- the next pg_cron tick.
  FOR v_job IN
    SELECT id, project_id, report_id, coordination_id, dispatch_metadata
    FROM   public.fix_dispatch_jobs
    WHERE  status = 'queued'
      AND  (
             (coordination_id IS NOT NULL AND created_at < now() - interval '30 seconds')
          OR (coordination_id IS NULL     AND created_at < now() - interval '2 minutes')
           )
    ORDER  BY created_at ASC
    LIMIT  20
    FOR UPDATE SKIP LOCKED
  LOOP
    v_rows_in := v_rows_in + 1;

    -- Invoke fix-worker via pg_net (Supabase net extension). The row stays
    -- 'queued' so that fix-worker can claim it atomically via its own
    --   UPDATE ... SET status='running' WHERE id=? AND status='queued'
    -- guard.  The FOR UPDATE SKIP LOCKED above prevents concurrent sweeper
    -- ticks from enqueuing the same job twice within the same pg_cron
    -- window; a duplicate HTTP invoke from back-to-back ticks is harmless
    -- because the second fix-worker call sees status≠'queued' and 409s.
    -- Non-fatal if pg_net is unavailable — falls through to the EXCEPTION
    -- handler which reverts status to 'queued' (no-op) and raises a warning.
    BEGIN
      PERFORM net.http_post(
        url     := v_api_url || '/functions/v1/fix-worker',
        headers := jsonb_build_object(
          'Content-Type',   'application/json',
          'Authorization',  v_auth_header
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

  -- Stranded-job alert: queued jobs older than 10 minutes now mean the
  -- sweeper itself is repeatedly failing to invoke (pg_net down, bad
  -- config) — surface for human inspection.
  DECLARE
    v_stranded integer;
  BEGIN
    SELECT COUNT(*) INTO v_stranded
    FROM   public.fix_dispatch_jobs
    WHERE  status = 'queued'
      AND  created_at < now() - interval '10 minutes';

    IF v_stranded > 0 THEN
      RAISE WARNING 'fix_dispatch_sweeper: % stranded queued job(s) older than 10 min despite requeue — check pg_net / runtime config', v_stranded;
    END IF;
  END;

  -- Emit pipeline_runs row for observability
  INSERT INTO public.pipeline_runs (id, run_name, rows_in, rows_out, rows_blocked, finished_at)
  VALUES (v_run_id, 'fix_dispatch_sweeper', v_rows_in, v_rows_out, v_rows_blocked, now());

  RAISE NOTICE 'fix_dispatch_sweeper: done — in=%, out=%, blocked=%', v_rows_in, v_rows_out, v_rows_blocked;
END;
$$;

COMMENT ON FUNCTION public.fix_dispatch_sweeper() IS
  'pg_cron worker: drains queued fix_dispatch_jobs — fan-out siblings after '
  '30s and primary dispatches after 2min (lost fire-and-forget invokes). '
  'Config resolves GUC override -> mushi runtime helpers. Invokes fix-worker '
  'edge function per job via pg_net. Advisory-lock guarded. Emits '
  'pipeline_runs row per execution, including unconfigured skips.';

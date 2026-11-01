-- =============================================================================
-- Migration: local_agent_claim (Plan 023 Phase 3, ADR 0034)
-- =============================================================================
-- APPLY ORDER: before deploying the `api` function that registers
-- POST /v1/admin/agent/claim and /v1/admin/agent/attempts/:id/report. Adds
-- columns and functions only; nothing existing reads them, so it is safe
-- before or after any other deploy.
--
-- A fix dispatched with `agent: 'local'` is run by the developer's own
-- machine (`mushi agent serve`). The dispatch route inserts a fix_attempts
-- row with agent = 'local', status = 'queued' and a 'running' dispatch job
-- (so fix_dispatch_sweeper never hands it to the edge fix-worker). A machine
-- claims the oldest one its key can reach:
--
--   claim_local_fix_attempt(project_ids, key_id, user_id, lease_seconds)
--     one UPDATE … FROM (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1), so two
--     machines polling at once get different attempts; sets status
--     'running' and a lease (claimed_until, 30 min by default). A machine
--     that crashes stops renewing the lease; once it lapses the attempt is
--     claimable again.
--
--   local_fix_attempts_expire()  (pg_cron, every 10 min)
--     a local attempt nobody finished within 24 h (no machine running
--     `mushi agent serve`, or every claim lapsed) fails with
--     failure_category 'local_agent_error', closing its dispatch job so the
--     report can be re-dispatched with another agent.
--
-- fix_attempts_stuck_reaper leaves these alone: its step 1 skips attempts
-- with an external_agent_ref (always set, NOT NULL DEFAULT '{}'), and its
-- step 3 skips attempts whose dispatch job is still 'running'.
--
-- Verification (after apply):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'fix_attempts'
--      AND column_name IN ('claimed_at', 'claimed_until', 'claimed_by_key_id', 'claimed_by_user_id');   -- 4 rows
--   SELECT has_function_privilege('authenticated', 'public.claim_local_fix_attempt(uuid[], uuid, uuid, integer)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('service_role', 'public.claim_local_fix_attempt(uuid[], uuid, uuid, integer)', 'EXECUTE');   -- true
--   SELECT public.claim_local_fix_attempt(ARRAY[]::uuid[], NULL, NULL, 1800);  -- no rows
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'local-fix-attempts-expire';
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Claim columns
-- -----------------------------------------------------------------------------
ALTER TABLE public.fix_attempts
  ADD COLUMN IF NOT EXISTS claimed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_until      timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_by_key_id  uuid REFERENCES public.project_api_keys(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_by_user_id uuid;

COMMENT ON COLUMN public.fix_attempts.claimed_until IS
  'Local fix agent (agent = ''local'') lease. Set by claim_local_fix_attempt() and '
  'renewed by POST /v1/admin/agent/attempts/:id/report {status: running}. A '
  '''running'' local attempt whose lease has lapsed is claimable again.';
COMMENT ON COLUMN public.fix_attempts.claimed_by_key_id IS
  'The API key that claimed this local attempt; only that key (or a project member '
  'signed in to the console) may report its outcome. NULL for a console claim.';

CREATE INDEX IF NOT EXISTS idx_fix_attempts_local_claimable
  ON public.fix_attempts (created_at)
  WHERE agent = 'local' AND status IN ('queued', 'running');

-- -----------------------------------------------------------------------------
-- 2. failure_category: local_agent_error
-- -----------------------------------------------------------------------------
ALTER TABLE public.fix_attempts
  DROP CONSTRAINT IF EXISTS fix_attempts_failure_category_check;

ALTER TABLE public.fix_attempts
  ADD CONSTRAINT fix_attempts_failure_category_check
  CHECK (
    failure_category IS NULL OR failure_category = ANY (ARRAY[
      'sandbox_timeout',
      'sandbox_error',
      'validation_rejected',
      'spec_violation',
      'scope_blocked',
      'llm_invalid_json',
      'llm_no_object',
      'llm_rate_limit',
      'llm_schema_violation',
      'llm_other_error',
      'github_403',
      'github_404',
      'github_422',
      'github_other_error',
      'cursor_api_error',
      'cursor_invalid_model',
      'cursor_validation_error',
      'embedding_provider_html_response',
      'upstream_internal_server',
      'no_relevant_code',
      'context_assembly_failed',
      'unknown',
      'claude_api_error',
      'claude_workflow_missing',
      'claude_repo_dispatch_failed',
      'already_fixed',
      'wrong_repo',
      'not_actionable',
      'needs_human',
      'local_agent_error'
    ])
  );

-- -----------------------------------------------------------------------------
-- 3. Atomic claim
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_local_fix_attempt(
  p_project_ids   uuid[],
  p_key_id        uuid    DEFAULT NULL,
  p_user_id       uuid    DEFAULT NULL,
  p_lease_seconds integer DEFAULT 1800
)
RETURNS TABLE (
  id                 uuid,
  project_id         uuid,
  report_id          uuid,
  branch_name        text,
  repo_id            uuid,
  external_agent_ref jsonb,
  claimed_until      timestamptz,
  reclaimed          boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH next AS (
    SELECT fa.id, (fa.status = 'running') AS reclaimed
    FROM   public.fix_attempts fa
    WHERE  fa.agent = 'local'
      AND  fa.project_id = ANY (COALESCE(p_project_ids, ARRAY[]::uuid[]))
      AND  (    fa.status = 'queued'
             -- Claimed by a machine that stopped renewing its lease.
             OR (fa.status = 'running' AND fa.claimed_until IS NOT NULL AND fa.claimed_until < now()))
    ORDER  BY fa.created_at
    LIMIT  1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.fix_attempts fa
  SET    status             = 'running',
         claimed_at         = now(),
         claimed_until      = now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 1800), 60), 7200)),
         claimed_by_key_id  = p_key_id,
         claimed_by_user_id = p_user_id,
         started_at         = now(),
         updated_at         = now()
  FROM   next
  WHERE  fa.id = next.id
  RETURNING fa.id, fa.project_id, fa.report_id, fa.branch_name, fa.repo_id,
            fa.external_agent_ref, fa.claimed_until, next.reclaimed;
$$;

COMMENT ON FUNCTION public.claim_local_fix_attempt(uuid[], uuid, uuid, integer) IS
  'Atomically claims the oldest local fix attempt (agent = ''local'') in the given '
  'projects that is queued, or running with a lapsed lease. FOR UPDATE SKIP LOCKED: '
  'two machines polling together get different attempts. Sets status running and a '
  'lease of p_lease_seconds (60 to 7200, default 1800). Called by the api function '
  'with the service role after it resolved the caller''s projects (Plan 023).';

REVOKE ALL     ON FUNCTION public.claim_local_fix_attempt(uuid[], uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_local_fix_attempt(uuid[], uuid, uuid, integer) TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Expiry of local attempts nobody finished
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.local_fix_attempts_expire()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stale AS (
    SELECT fa.id
    FROM   public.fix_attempts fa
    WHERE  fa.agent = 'local'
      AND  fa.created_at < now() - interval '24 hours'
      AND  (    fa.status = 'queued'
             OR (fa.status = 'running' AND (fa.claimed_until IS NULL OR fa.claimed_until < now())))
    FOR UPDATE OF fa SKIP LOCKED
  ),
  upd AS (
    UPDATE public.fix_attempts fa
    SET    status           = 'failed',
           failure_category = 'local_agent_error',
           error            = 'No machine running `mushi agent serve` finished this fix within 24 hours. Start one, or re-dispatch with another agent.',
           completed_at     = now()
    FROM   stale
    WHERE  fa.id = stale.id
    RETURNING fa.id, fa.report_id
  ),
  jobs AS (
    UPDATE public.fix_dispatch_jobs j
    SET    status      = 'failed',
           error       = 'Local fix agent: nothing finished within 24 hours. Safe to re-dispatch.',
           finished_at = now()
    FROM   upd
    WHERE  j.fix_attempt_id = upd.id
      AND  j.status IN ('queued', 'running')
    RETURNING j.id
  ),
  rep AS (
    UPDATE public.reports r
    SET    processing_error = 'autofix_blocked: the local fix agent did not finish within 24 hours. Re-dispatch when ready.'
    FROM   upd
    WHERE  r.id = upd.report_id
      AND  r.status NOT IN ('fixed', 'verified', 'dismissed')
    RETURNING r.id
  )
  SELECT count(*) INTO v_count FROM upd;

  IF v_count > 0 THEN
    INSERT INTO public.pipeline_runs (run_name, rows_in, rows_out, rows_blocked, finished_at)
    VALUES ('local_fix_attempts_expire', v_count, v_count, 0, now());
  END IF;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.local_fix_attempts_expire() IS
  'pg_cron worker (every 10 min): fails local fix attempts (agent = ''local'') older '
  'than 24 h that are still queued or whose lease lapsed, with their dispatch job, '
  'so the report can be re-dispatched (Plan 023).';

REVOKE ALL     ON FUNCTION public.local_fix_attempts_expire() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.local_fix_attempts_expire() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping local-fix-attempts-expire schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'local-fix-attempts-expire';

  PERFORM cron.schedule(
    'local-fix-attempts-expire',
    '4-54/10 * * * *',
    'SELECT public.local_fix_attempts_expire()'
  );
END $$;

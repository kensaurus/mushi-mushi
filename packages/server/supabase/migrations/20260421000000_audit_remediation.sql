-- =============================================================================
-- Audit remediation migration — addresses findings from the
-- 2026-04-21 full-depth audit (see docs/audit-summary-2026-04-21.md).
--
-- Contents (each block stands alone so this migration can be re-run):
--   1. DB-1  — add indexes for every foreign key that lacks one (20+).
--   2. LLM-3 — add cache_creation_input_tokens + cache_read_input_tokens
--              columns on llm_invocations so prompt-caching effectiveness
--              is observable in Billing / Health.
--   3. LLM-5 — nightly reconciliation of classification_evaluations into
--              prompt_versions.avg_judge_score / total_evaluations so the
--              auto-tuning loop is no longer dormant.
--   4. PERF-1 — early-exit guard + composite index for
--               recover_stranded_pipeline() so the */5-minute cron returns
--               in O(1) time when the queue is empty.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. DB-1: Cover every FK with an index.
--
-- We discover unindexed FKs dynamically rather than hard-coding the list so
-- this migration keeps working as the schema grows. For every FK constraint
-- on a single column in the public schema, we emit a
-- CREATE INDEX IF NOT EXISTS <table>_<column>_fkey_idx ON <table>(<column>).
--
-- Note: CREATE INDEX CONCURRENTLY is NOT allowed inside a transaction, and
-- supabase migrations run in a transaction. Plain CREATE INDEX is acceptable
-- here because (a) every referenced table is currently small (<1000 rows)
-- per the audit and (b) the write lock on an empty table is instantaneous.
-- At production scale, follow up with a manual CONCURRENTLY rebuild.
-- -----------------------------------------------------------------------------
DO $fk_indexes$
DECLARE
  rec record;
  stmt text;
BEGIN
  FOR rec IN
    SELECT
      n.nspname       AS schema_name,
      cl.relname      AS table_name,
      a.attname       AS column_name,
      con.conname     AS constraint_name
    FROM pg_constraint con
    JOIN pg_class cl      ON cl.oid = con.conrelid
    JOIN pg_namespace n   ON n.oid = cl.relnamespace
    JOIN pg_attribute a   ON a.attrelid = cl.oid AND a.attnum = ANY (con.conkey)
    WHERE con.contype = 'f'
      AND array_length(con.conkey, 1) = 1
      AND n.nspname = 'public'
      AND NOT EXISTS (
        -- Any existing index that leads with this column on this table.
        SELECT 1
        FROM pg_index idx
        JOIN pg_class ic ON ic.oid = idx.indexrelid
        WHERE idx.indrelid = cl.oid
          AND idx.indkey[0] = a.attnum
      )
  LOOP
    stmt := format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I(%I)',
      rec.table_name || '_' || rec.column_name || '_fkey_idx',
      rec.schema_name,
      rec.table_name,
      rec.column_name
    );
    RAISE NOTICE 'FK index: %', stmt;
    EXECUTE stmt;
  END LOOP;
END
$fk_indexes$;

-- -----------------------------------------------------------------------------
-- 2. LLM-3: Anthropic prompt-cache token columns on llm_invocations.
--
-- Anthropic's cache_creation_input_tokens is billed at 1.25x regular input;
-- cache_read_input_tokens is billed at 0.1x. The audit measured per-report
-- cost at ~10x the whitepaper claim — capturing these lets Billing prove
-- the ~90% cache-hit rate the Stage 2 system prompt should achieve.
-- -----------------------------------------------------------------------------
ALTER TABLE public.llm_invocations
  ADD COLUMN IF NOT EXISTS cache_creation_input_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_read_input_tokens     integer;

COMMENT ON COLUMN public.llm_invocations.cache_creation_input_tokens IS
  'Anthropic prompt-cache tokens billed at 1.25x regular input. First call per 5-min TTL.';
COMMENT ON COLUMN public.llm_invocations.cache_read_input_tokens IS
  'Anthropic prompt-cache tokens billed at 0.1x regular input. Subsequent calls within TTL.';

-- -----------------------------------------------------------------------------
-- 3. LLM-5: prompt_versions aggregation reconciliation.
--
-- The audit found avg_judge_score and total_evaluations are never populated
-- in prompt_versions despite classification_evaluations recording
-- per-report judge_score + prompt_version. Root cause: recordPromptResult()
-- silently no-ops when the prompt_version string in the report doesn't
-- exactly match a prompt_versions row (project scope / string drift).
--
-- Fix: run a nightly reconciliation that computes the aggregate from the
-- source of truth (classification_evaluations) and writes it back. The
-- function is idempotent; losing a run is safe.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_prompt_version_scores()
RETURNS TABLE(updated_rows int, total_evaluated_across_all int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $reconcile$
DECLARE
  v_updated int := 0;
  v_total   int := 0;
BEGIN
  -- Rebuild prompt_versions.avg_judge_score / total_evaluations from the
  -- classification_evaluations source of truth. We scope-match on
  -- (project_id, version) because the same version string can legitimately
  -- exist in multiple projects with independent performance.
  WITH agg AS (
    SELECT
      ce.project_id,
      ce.prompt_version,
      avg(ce.judge_score)::numeric       AS new_avg,
      count(*)::int                      AS new_count
    FROM classification_evaluations ce
    WHERE ce.prompt_version IS NOT NULL
    GROUP BY ce.project_id, ce.prompt_version
  ),
  updated AS (
    UPDATE prompt_versions pv
       SET avg_judge_score   = a.new_avg,
           total_evaluations = a.new_count
      FROM agg a
     WHERE pv.version   = a.prompt_version
       AND pv.project_id IS NOT DISTINCT FROM a.project_id
       -- Skip unchanged rows so we don't rewrite 10k identical tuples/night.
       AND (pv.avg_judge_score   IS DISTINCT FROM a.new_avg
         OR pv.total_evaluations IS DISTINCT FROM a.new_count)
    RETURNING pv.id
  )
  SELECT count(*) INTO v_updated FROM updated;

  SELECT count(*) INTO v_total FROM classification_evaluations WHERE prompt_version IS NOT NULL;

  RETURN QUERY SELECT v_updated, v_total;
END
$reconcile$;

REVOKE ALL ON FUNCTION public.reconcile_prompt_version_scores() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_prompt_version_scores() TO service_role, postgres;

-- Schedule nightly at 03:17 UTC — 17 min past the hour so it doesn't collide
-- with the judge-batch nightly run (which historically runs at 03:00).
DO $reconcile_cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping reconcile schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-reconcile-prompt-scores-nightly';

  PERFORM cron.schedule(
    'mushi-reconcile-prompt-scores-nightly',
    '17 3 * * *',
    $cron$ SELECT public.reconcile_prompt_version_scores(); $cron$
  );
END
$reconcile_cron$;

-- -----------------------------------------------------------------------------
-- 4. PERF-1: recover_stranded_pipeline early-exit guard.
--
-- Cron fires every 5 minutes. Each run scans `reports` for stuck rows. With
-- the default schema lacking an index on (status, created_at) the planner
-- fell back to a sequential scan — benign at 52 rows, but O(N) at 50k rows
-- is 5-minute latency on a job with a 5-minute budget. Two mitigations:
--   a) composite index on (status, created_at) to cover the stranded query.
--   b) 1-second early-exit when the relevant queues are empty, so 99% of
--      runs return immediately without touching anything.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS reports_status_created_at_idx
  ON public.reports (status, created_at)
  WHERE status IN ('new', 'queued');

CREATE INDEX IF NOT EXISTS processing_queue_status_created_at_idx
  ON public.processing_queue (status, created_at)
  WHERE status IN ('pending', 'failed');

CREATE OR REPLACE FUNCTION public.recover_stranded_pipeline()
RETURNS TABLE(stranded_reports int, retried_queue int, reconciled_completed int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $recover$
DECLARE
  v_url               text;
  v_stranded_reports  int  := 0;
  v_retried_queue     int  := 0;
  v_reconciled        int  := 0;
  v_has_work          boolean;
  rec record;
BEGIN
  -- Cheap existence probe using the partial indexes above. If neither
  -- reports nor the queue has an eligible row, return in O(1). This is
  -- the common case — the full body below is for the ~1% of runs that
  -- actually have something to reconcile.
  SELECT EXISTS (
    SELECT 1 FROM reports
     WHERE status IN ('new', 'queued')
       AND created_at < now() - interval '5 minutes'
       AND processing_attempts < 3
    UNION ALL
    SELECT 1 FROM processing_queue pq
     WHERE pq.status IN ('pending', 'failed')
  ) INTO v_has_work;

  IF NOT v_has_work THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  SELECT value INTO v_url FROM public.mushi_runtime_config WHERE key = 'supabase_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE WARNING 'recover_stranded_pipeline: mushi_runtime_config.supabase_url missing';
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  -- 1. Reconcile queue items whose report has already advanced past stage1
  --    (race where fast-filter wrote reports.status='classified' but the
  --    queue update didn't land before the function returned).
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

  -- 2. Re-invoke fast-filter for reports stuck in `new`/`queued` past SLA.
  --    Bounded at 25/run so a backlog burst doesn't overwhelm the provider.
  --    PERF-1: fast-filter now requires the service-role bearer — include it.
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
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (SELECT value FROM public.mushi_runtime_config WHERE key = 'service_role_key')
      ),
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
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || (SELECT value FROM public.mushi_runtime_config WHERE key = 'service_role_key')
      ),
      body    := jsonb_build_object('reportId', rec.report_id::text, 'projectId', rec.project_id::text)
    );
    v_retried_queue := v_retried_queue + 1;
  END LOOP;

  -- Audit trail so the admin /queue page can show "last recovery ran X min ago".
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
END
$recover$;

REVOKE ALL ON FUNCTION public.recover_stranded_pipeline() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stranded_pipeline() TO service_role, postgres;

COMMENT ON FUNCTION public.recover_stranded_pipeline() IS
  'Re-queues stranded reports / processing_queue items. Early-exit when no work. SEC-1 requires service_role_key in mushi_runtime_config for fast-filter auth.';

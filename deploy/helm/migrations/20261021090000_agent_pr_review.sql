-- ============================================================================
-- 20261021090000_agent_pr_review
--
-- Agent PR review gate (ADR 0030). Every pull request a cloud coding agent
-- (cursor_cloud / github_cloud_agent) opens as a fix gets an independent
-- review by Claude Opus 5.5 on the project's own Anthropic key. The verdict
-- (merge / fix_first / hold) is stored here, shown on the fix timeline and
-- as a PR comment, and a "hold" blocks POST /v1/admin/fixes/:id/merge,
-- merge_fix and the console merge until someone overrides it.
--
-- ADDITIVE: one table, one project_settings column (default on), one
-- appended fix_events.kind value ('reviewed'), one cron job.
-- Apply BEFORE deploying agent-pr-review and the api function.
-- ============================================================================

-- Per-project switch. On by default: reviews only run when the project has
-- an Anthropic key of its own (or its organization's shared one).
ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS agent_pr_review_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.project_settings.agent_pr_review_enabled IS
  'Agent PR review (ADR 0030): review every cloud coding agent PR with Claude Opus 5.5 on the project''s Anthropic key; a "hold" verdict blocks merging from Mushi without an override. Default true.';

-- One review per fix attempt. The verdict columns hold the latest COMPLETED
-- review: a re-run (manual or after a push) sets status back to 'queued' and
-- keeps them, so the merge gate keeps reading a hold until the new review
-- completes. run_id is the claim token of the run that owns the row; every
-- write of a run is guarded on it, so a superseded run cannot overwrite.
CREATE TABLE IF NOT EXISTS public.fix_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fix_attempt_id        uuid NOT NULL UNIQUE REFERENCES public.fix_attempts(id) ON DELETE CASCADE,
  project_id            uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_id             uuid REFERENCES public.reports(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued', 'running', 'completed', 'skipped', 'failed')),
  attempts              integer NOT NULL DEFAULT 0,
  run_id                uuid,
  skip_reason           text,
  error                 text,
  pr_url                text,
  head_sha              text,
  verdict               text CHECK (verdict IS NULL OR verdict IN ('merge', 'fix_first', 'hold')),
  fixes_report          boolean,
  risk                  text CHECK (risk IS NULL OR risk IN ('low', 'med', 'high')),
  findings              jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_creep           boolean,
  removes_behavior      jsonb NOT NULL DEFAULT '[]'::jsonb,
  needs_human_decision  text,
  summary               text,
  rules_applied         jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff_truncated        boolean NOT NULL DEFAULT false,
  diff_stats            jsonb,
  ci_state              text,
  model                 text,
  input_tokens          integer,
  output_tokens         integer,
  cost_usd              numeric(10, 4),
  comment_id            bigint,
  comment_url           text,
  reviewed_at           timestamptz,
  queued_at             timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fix_reviews_completed_has_verdict
    CHECK (status <> 'completed' OR verdict IS NOT NULL),
  CONSTRAINT fix_reviews_verdict_has_commit
    CHECK (verdict IS NULL OR (head_sha IS NOT NULL AND reviewed_at IS NOT NULL))
);

COMMENT ON TABLE public.fix_reviews IS
  'Independent Claude Opus review of a cloud coding agent''s pull request (ADR 0030): verdict, findings, removed behaviour, model, tokens and cost. Written by agent-pr-review (service role); read by the merge gate, the fix timeline and the console.';

-- The worker drains due queued rows (queued_at <= now) oldest first; a retry
-- or a push pushes queued_at into the future.
CREATE INDEX IF NOT EXISTS idx_fix_reviews_queue
  ON public.fix_reviews (queued_at)
  WHERE status = 'queued';
-- Stale `running` rows are put back in the queue after 15 minutes.
CREATE INDEX IF NOT EXISTS idx_fix_reviews_running
  ON public.fix_reviews (started_at)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_fix_reviews_project
  ON public.fix_reviews (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fix_reviews_report_id
  ON public.fix_reviews (report_id)
  WHERE report_id IS NOT NULL;

-- RLS: project members read (the same rule as fix_attempts_member_select);
-- writes only through the service role.
ALTER TABLE public.fix_reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fix_reviews' AND policyname = 'fix_reviews_member_select') THEN
    CREATE POLICY fix_reviews_member_select ON public.fix_reviews
      FOR SELECT TO authenticated
      USING (
        project_id IN (
          SELECT id FROM public.projects
          WHERE owner_id = (SELECT auth.uid())
        )
        OR private.is_project_member(project_id)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fix_reviews' AND policyname = 'fix_reviews_service_write') THEN
    CREATE POLICY fix_reviews_service_write ON public.fix_reviews
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE public.fix_reviews FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.fix_reviews FROM authenticated;
GRANT SELECT ON TABLE public.fix_reviews TO authenticated;

-- fix_events.kind: append 'reviewed' to the live list, read from the live
-- constraint so a value added elsewhere is never dropped.
DO $$
DECLARE
  v_name text;
  v_def  text;
  v_vals text[];
  v_add  text[] := ARRAY['reviewed'];
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def
    FROM pg_constraint
   WHERE conrelid = 'public.fix_events'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%kind%'
   LIMIT 1;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'fix_events kind check not found; refusing to guess the allowed kinds';
  END IF;

  SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) INTO v_vals
    FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS m;
  IF v_vals IS NULL OR array_length(v_vals, 1) = 0 THEN
    RAISE EXCEPTION 'could not read the values of %: %', v_name, v_def;
  END IF;
  IF v_add <@ v_vals THEN
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE public.fix_events DROP CONSTRAINT %I', v_name);
  EXECUTE format(
    'ALTER TABLE public.fix_events ADD CONSTRAINT fix_events_kind_check CHECK (kind IN (%s))',
    (SELECT string_agg(quote_literal(x), ', ' ORDER BY x) FROM (SELECT DISTINCT unnest(v_vals || v_add) AS x) u)
  );
END $$;

-- Every 10 minutes at :03, :13, …, :53: after agent-status-poll (5-55/5)
-- has attached the PRs. At most 3 reviews per tick (the worker's batch).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-agent-pr-review schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-agent-pr-review';

  PERFORM cron.schedule(
    'mushi-agent-pr-review',
    '3-53/10 * * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/agent-pr-review',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := '{"trigger":"cron"}'::jsonb
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );
END $$;

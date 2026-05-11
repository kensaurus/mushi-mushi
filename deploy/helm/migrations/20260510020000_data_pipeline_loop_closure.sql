-- ============================================================================
-- 20260510020000_data_pipeline_loop_closure.sql
--
-- Closes 5 PDCA loops that previously generated signal then discarded it.
-- Schema-only changes; the corresponding edge-function logic ships in the
-- same PR (fix-worker, prompt-auto-tune, generate-synthetic, classify-report,
-- inventory-propose).
--
-- Loops closed
-- ------------
--   1. PR merge outcome → judge + prompt-tuner training corpus
--      (no schema change — the join is purely in `prompt-auto-tune`'s
--      query against fix_attempts.merged_at + fix_attempts.pr_state, which
--      already exist as of 20260509100000_inventory_action_traceability.sql)
--
--   2. Merged fixes → RAG corpus (`fix_corpus` pgvector + RPC)
--
--   3. Failed-dispatch reasons → `fix_attempts.failure_category` enum
--
--   4. Reporter feedback → `report_comments.feedback_signal` enum
--
--   5. Inventory drift → `pg_cron` entry that re-fires `inventory-propose`
--      (cron registration only — the auto-trigger logic ships in the
--      inventory-propose edge function in the same PR)
--
-- Idempotent: every CREATE TABLE / ADD COLUMN / CREATE INDEX is guarded;
-- the cron upsert is a single INSERT … ON CONFLICT.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2. Merged fixes → RAG corpus (`fix_corpus` pgvector + RPC)
--
-- The RAG corpus lives in `project_codebase_files` today — generic source
-- chunks indexed by sha + symbol_name. When a fix PR merges, the worker
-- has already produced the highest-quality teaching example we can get:
-- the diff that fixed a real user-felt bug, validated by a human review +
-- merge. Indexing those into a separate `fix_corpus` table (vs. inlining
-- into `project_codebase_files`) keeps the recall path clean — the
-- fix-worker can choose to retrieve "past similar fixes" as a SECOND
-- retrieval signal alongside the existing source-chunk retrieval, and
-- weight them differently in the prompt.
--
-- Columns chosen for retrieval, not analytics: `summary` + `rationale` are
-- already on `fix_attempts`; we re-flatten them here so the table is
-- self-contained and the embedding pipeline doesn't need to JOIN at query
-- time. `embedding_input` is the exact text we embedded — kept so we can
-- re-embed on a model upgrade without rebuilding the prompts.
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.fix_corpus (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  fix_attempt_id    UUID NOT NULL REFERENCES public.fix_attempts(id) ON DELETE CASCADE,
  report_id          UUID REFERENCES public.reports(id) ON DELETE SET NULL,
  -- The summary of the original bug, denormalised for retrieval.
  bug_summary        TEXT NOT NULL,
  -- One-line description of what the fix did.
  fix_summary        TEXT NOT NULL,
  -- Full natural-language rationale from the orchestrator's diff plan.
  rationale          TEXT,
  -- Files the fix touched — kept as TEXT[] so retrieval can filter by
  -- "fixes that touched src/auth/" without joining back.
  files_changed      TEXT[] NOT NULL DEFAULT '{}',
  -- The text we actually embedded (bug summary + fix summary + rationale,
  -- truncated to fit text-embedding-3-small's 8191-token window).
  embedding_input    TEXT NOT NULL,
  embedding          VECTOR(1536),
  embedding_model    TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  -- When the upstream PR merged. Sort key for "recent fixes first" recall
  -- when two embeddings tie on cosine distance.
  merged_at          TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fix_corpus_project ON public.fix_corpus(project_id, merged_at DESC);
CREATE INDEX IF NOT EXISTS idx_fix_corpus_fix_attempt ON public.fix_corpus(fix_attempt_id);
-- HNSW on the embedding column — Supabase's recommended index for similarity
-- recall in pgvector ≥0.7. m=16, ef_construction=64 are the published
-- defaults for the "good recall vs. cheap build" sweet spot at the row
-- counts a typical project produces (≤10k merged fixes/yr).
CREATE INDEX IF NOT EXISTS idx_fix_corpus_embedding ON public.fix_corpus
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE public.fix_corpus ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fix_corpus_project_read ON public.fix_corpus;
CREATE POLICY fix_corpus_project_read ON public.fix_corpus
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = fix_corpus.project_id
        AND pm.user_id = (SELECT auth.uid())
    )
  );

COMMENT ON TABLE public.fix_corpus IS
  'pgvector store of past merged fixes — populated by the GitHub merge webhook on `pull_request.closed:merged`. Retrieved by `match_fix_corpus` RPC and consumed by fix-worker as a "past similar fixes" prompt context.';

-- RPC for cosine-similarity retrieval. Mirrors the shape of
-- `match_codebase_files` so the fix-worker call site stays uniform.
CREATE OR REPLACE FUNCTION public.match_fix_corpus(
  query_embedding VECTOR(1536),
  match_project   UUID,
  match_count     INT DEFAULT 3
)
RETURNS TABLE (
  id              UUID,
  fix_attempt_id  UUID,
  report_id       UUID,
  bug_summary     TEXT,
  fix_summary     TEXT,
  rationale       TEXT,
  files_changed   TEXT[],
  merged_at       TIMESTAMPTZ,
  similarity      FLOAT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
-- pgvector ships its operators in the `extensions` schema on Supabase, so a
-- search_path of just `public` would cause `<=>` (cosine distance) to resolve
-- to "operator does not exist" at runtime. We add `extensions` and
-- `pg_catalog` (system) but not `auth`/`storage` to keep the SECURITY DEFINER
-- attack surface narrow. We also fully-qualify with OPERATOR(extensions.<=>)
-- as a belt-and-braces defence in case search_path resolution changes.
SET search_path = public, extensions, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    fc.id,
    fc.fix_attempt_id,
    fc.report_id,
    fc.bug_summary,
    fc.fix_summary,
    fc.rationale,
    fc.files_changed,
    fc.merged_at,
    1 - (fc.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
  FROM public.fix_corpus fc
  WHERE fc.project_id = match_project
    AND fc.embedding IS NOT NULL
  ORDER BY fc.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION public.match_fix_corpus IS
  'Cosine-similarity retrieval over fix_corpus, scoped to a single project. Returns top-N past fixes by embedding distance; mirrors the shape of match_codebase_files so the fix-worker call site stays uniform.';

-- ----------------------------------------------------------------------------
-- 3. Failed-dispatch reasons → `fix_attempts.failure_category` enum
--
-- Today the reason a dispatch failed is a free-text `error` column. The
-- admin UI renders it verbatim and the `FixSummaryRow` only shows a daily
-- count. Adding a categorical column lets us aggregate ("why is our
-- success rate dropping?") and lets the prompt-tuner filter training
-- samples by failure mode.
--
-- The category list is bounded — picked from the actual failure modes the
-- fix-worker emits today. Anything not classified stays NULL.
-- ----------------------------------------------------------------------------
ALTER TABLE public.fix_attempts
  ADD COLUMN IF NOT EXISTS failure_category TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fix_attempts_failure_category_check'
  ) THEN
    ALTER TABLE public.fix_attempts
      ADD CONSTRAINT fix_attempts_failure_category_check CHECK (
        failure_category IS NULL OR failure_category IN (
          'sandbox_timeout',
          'sandbox_error',
          'validation_rejected',
          'spec_violation',
          'scope_blocked',
          'llm_invalid_json',
          'llm_no_object',
          'llm_rate_limit',
          'llm_other_error',
          'github_403',
          'github_404',
          'github_422',
          'github_other_error',
          'no_relevant_code',
          'context_assembly_failed',
          'unknown'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.fix_attempts.failure_category IS
  'Categorised failure reason — populated by `categorizeFailure()` in fix-worker on every fail path. Aggregated by the FixSummaryRow tile and read by prompt-auto-tune when filtering training samples.';

CREATE INDEX IF NOT EXISTS idx_fix_attempts_failure_category
  ON public.fix_attempts(project_id, failure_category, created_at DESC)
  WHERE status = 'failed' AND failure_category IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. Reporter feedback → `report_comments.feedback_signal` enum
--
-- Reporters can already reply via the SDK's two-way comments path
-- (migration 20260430000000_two_way_reply.sql). Today the body is free
-- text, so the judge / prompt-tuner cannot use the reply as a structured
-- training signal. Adding a small enum lets the SDK widget render chips
-- for the most common reactions and gives the learning pipeline an
-- explicit ground-truth oracle.
--
-- 'confirms'              — yes, this IS the bug I meant
-- 'wrong_target'          — agent fixed something that wasn't the bug
-- 'agent_fixed_wrong_thing' — partial: bug is right, fix is wrong
-- 'already_fixed'         — false positive — bug is gone now
-- 'noise'                 — spam / off-topic / shouldn't have been classified
-- ----------------------------------------------------------------------------
ALTER TABLE public.report_comments
  ADD COLUMN IF NOT EXISTS feedback_signal TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'report_comments_feedback_signal_check'
  ) THEN
    ALTER TABLE public.report_comments
      ADD CONSTRAINT report_comments_feedback_signal_check CHECK (
        feedback_signal IS NULL OR feedback_signal IN (
          'confirms',
          'wrong_target',
          'agent_fixed_wrong_thing',
          'already_fixed',
          'noise'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.report_comments.feedback_signal IS
  'Structured reaction chip the SDK comment widget can attach to a reporter reply. NULL when the reply is plain conversation; one of the enum values when the reporter clicked a chip. Read by judge-batch + prompt-auto-tune as ground-truth labels.';

CREATE INDEX IF NOT EXISTS idx_report_comments_feedback_signal
  ON public.report_comments(report_id, feedback_signal, created_at DESC)
  WHERE feedback_signal IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. Multi-repo coordination columns on `fix_dispatch_jobs`
--
-- Schema-only — the actual fan-out logic lives in `fix-worker.ts:markCrossRepoSpan`.
-- `fix_attempts.coordination_id` already exists (migration 20260418001900),
-- but the dispatch-side counterparts were never added because the orchestrator
-- in `@mushi-mushi/agents` runs in Node, not Deno, and the hosted worker
-- couldn't fan out. We can now: when the worker detects a cross-repo span,
-- it inserts one child fix_dispatch_jobs row per matched sibling repo, each
-- carrying the coordination_id and a dispatch_metadata.target_repo_id hint.
-- ----------------------------------------------------------------------------
ALTER TABLE public.fix_dispatch_jobs
  ADD COLUMN IF NOT EXISTS coordination_id UUID REFERENCES public.fix_coordinations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatch_metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_fix_dispatch_jobs_coordination
  ON public.fix_dispatch_jobs(coordination_id)
  WHERE coordination_id IS NOT NULL;

COMMENT ON COLUMN public.fix_dispatch_jobs.coordination_id IS
  'When set, this dispatch is one leg of a multi-repo coordinated fix. The parent fix_coordinations row holds the plan; sibling dispatches share the same id.';
COMMENT ON COLUMN public.fix_dispatch_jobs.dispatch_metadata IS
  'Worker-routed hints. Currently used for cross-repo fan-out: target_repo_id, target_repo_url, coordinated_with_pr.';

-- ----------------------------------------------------------------------------
-- 5. Inventory drift → `pg_cron` entry
--
-- `inventory-propose` is invoked exclusively via POST today. With this
-- entry it also fires hourly from pg_cron — the function gates the LLM
-- call on `discovery_observed_inventory` divergence so projects without
-- drift incur zero cost.
--
-- We wrap in a DO block so the migration is idempotent across the
-- "extension may not be loaded yet" path on fresh self-hosted Postgres
-- installs.
-- ----------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule any previous run with this name — cron.schedule rejects
    -- duplicates by jobname and we want re-running this migration to
    -- update the schedule cleanly.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mushi-inventory-drift-watch') THEN
      PERFORM cron.unschedule('mushi-inventory-drift-watch');
    END IF;

    -- Use the public.mushi_runtime_supabase_url() / mushi_internal_auth_header()
    -- helpers (consistent with all other mushi crons). The previous
    -- current_setting('app.settings.*') approach silently no-ops on this project
    -- because those GUCs are not configured for the cron role.
    PERFORM cron.schedule(
      'mushi-inventory-drift-watch',
      '17 * * * *',  -- hourly at :17 to spread load away from other crons on :00
      $job$
        SELECT net.http_post(
          url     := public.mushi_runtime_supabase_url() || '/functions/v1/inventory-propose',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', public.mushi_internal_auth_header()),
          body    := jsonb_build_object('mode', 'drift_watch'),
          timeout_milliseconds := 30000
        )
        WHERE public.mushi_runtime_supabase_url() IS NOT NULL
          AND public.mushi_internal_auth_header() IS NOT NULL;
      $job$
    );
  END IF;
END $cron$;

-- Force PostgREST to drop its schema cache so the new columns are visible
-- to API callers immediately (same precaution as 20260430000000).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

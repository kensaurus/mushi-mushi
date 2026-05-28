-- Migration: Round 9 Supabase Advisor Cleanup (2026-05-21)
-- Closes: 15 unindexed_foreign_keys, 5 auth_rls_initplan, 2 materialized_view_in_api
-- Source: get_advisors() output from Phase C audit on 2026-05-21

-- ============================================================================
-- PART 1: Unindexed foreign keys (15 missing covering indexes)
-- Advisor: unindexed_foreign_keys
-- CREATE INDEX (without CONCURRENTLY) runs inside the migration transaction.
-- CONCURRENTLY cannot run inside a transaction block — Supabase migrations are
-- always wrapped in BEGIN/COMMIT, so CONCURRENTLY would error at deploy time.
-- IF NOT EXISTS makes each statement idempotent.
-- ============================================================================

CREATE INDEX IF NOT EXISTS
  idx_anomaly_detections_release_id
  ON public.anomaly_detections (release_id);

CREATE INDEX IF NOT EXISTS
  idx_drift_findings_snapshot_id
  ON public.drift_findings (snapshot_id);

CREATE INDEX IF NOT EXISTS
  idx_end_user_activity_project_id
  ON public.end_user_activity (project_id);

CREATE INDEX IF NOT EXISTS
  idx_end_user_activity_rule_id
  ON public.end_user_activity (rule_id);

CREATE INDEX IF NOT EXISTS
  idx_end_user_points_current_tier_id
  ON public.end_user_points (current_tier_id);

CREATE INDEX IF NOT EXISTS
  idx_experiment_assignments_variant_id
  ON public.experiment_assignments (variant_id);

CREATE INDEX IF NOT EXISTS
  idx_lessons_cluster_id
  ON public.lessons (cluster_id);

CREATE INDEX IF NOT EXISTS
  idx_metric_series_release_id
  ON public.metric_series (release_id);

CREATE INDEX IF NOT EXISTS
  idx_qa_stories_owner
  ON public.qa_stories (owner);

CREATE INDEX IF NOT EXISTS
  idx_quest_progress_completing_activity_id
  ON public.quest_progress (completing_activity_id);

CREATE INDEX IF NOT EXISTS
  idx_quest_progress_organization_id
  ON public.quest_progress (organization_id);

CREATE INDEX IF NOT EXISTS
  idx_release_credits_report_id
  ON public.release_credits (report_id);

CREATE INDEX IF NOT EXISTS
  idx_reward_disputes_activity_id
  ON public.reward_disputes (activity_id);

CREATE INDEX IF NOT EXISTS
  idx_reward_disputes_payout_id
  ON public.reward_disputes (payout_id);

CREATE INDEX IF NOT EXISTS
  idx_reward_disputes_resolved_by
  ON public.reward_disputes (resolved_by);


-- ============================================================================
-- PART 2: auth_rls_initplan — rewrite 5 policies to use subquery form
-- Advisor: auth_rls_initplan
-- `USING (auth.uid() = user_id)` re-evaluates auth.uid() per row.
-- `USING ((SELECT auth.uid()) = user_id)` evaluates it once as an initplan.
-- ============================================================================

-- qa_stories.qa_stories_all
ALTER POLICY qa_stories_all ON public.qa_stories
  USING ((SELECT auth.uid()) = owner);

-- qa_stories.qa_stories_select
ALTER POLICY qa_stories_select ON public.qa_stories
  USING ((SELECT auth.uid()) = owner);

-- qa_story_evidence.qa_story_evidence_select
ALTER POLICY qa_story_evidence_select ON public.qa_story_evidence
  USING (
    (SELECT auth.uid()) IN (
      SELECT qs.owner FROM public.qa_stories qs WHERE qs.id = qa_story_evidence.story_id
    )
  );

-- qa_story_runs.qa_story_runs_insert
-- INSERT policies use WITH CHECK (not USING) — USING only affects row
-- visibility for SELECT/UPDATE/DELETE, not INSERT permission.
ALTER POLICY qa_story_runs_insert ON public.qa_story_runs
  WITH CHECK (
    (SELECT auth.uid()) IN (
      SELECT qs.owner FROM public.qa_stories qs WHERE qs.id = qa_story_runs.story_id
    )
  );

-- qa_story_runs.qa_story_runs_select
ALTER POLICY qa_story_runs_select ON public.qa_story_runs
  USING (
    (SELECT auth.uid()) IN (
      SELECT qs.owner FROM public.qa_stories qs WHERE qs.id = qa_story_runs.story_id
    )
  );


-- ============================================================================
-- PART 3: Revoke SELECT on exposed materialized views from anon/authenticated
-- Advisor: materialized_view_in_api
-- These MVs are admin-only aggregations read via service-role. Granting public
-- access through PostgREST bypasses RLS and leaks platform-level aggregates.
-- ============================================================================

REVOKE SELECT ON public.qa_platform_rollup_24h FROM anon, authenticated;
REVOKE SELECT ON public.qa_story_coverage_24h FROM anon, authenticated;


-- ============================================================================
-- PART 4: Add repair_attempts and failure_diagnostic columns to fix_attempts
-- (Supports Phase B schema-repair retry — Round 9 2026-05-21)
-- ============================================================================

ALTER TABLE public.fix_attempts
  ADD COLUMN IF NOT EXISTS repair_attempts smallint DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS failure_diagnostic text;

COMMENT ON COLUMN public.fix_attempts.repair_attempts IS
  'Number of schema-repair retry attempts made before the LLM call succeeded or exhausted all retries. 0 = no retry needed.';

COMMENT ON COLUMN public.fix_attempts.failure_diagnostic IS
  'Human-readable diagnostic string built from Zod issues + raw LLM output slice when the fix-worker hits AI_NoObjectGeneratedError. Shown in the admin "Do bottleneck" UI card.';

-- Flush PostgREST schema/config cache so the new columns on fix_attempts are
-- immediately visible via the auto-generated REST API without a pod restart.
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

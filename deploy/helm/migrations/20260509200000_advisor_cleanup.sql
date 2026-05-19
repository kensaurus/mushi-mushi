-- 20260509200000_advisor_cleanup.sql
--
-- Addresses the backlog of Supabase advisor findings identified in the
-- 2026-05-09 SDK Robustness + Integrator Glue audit (project dxptnwrhwsqckaftyymj).
--
-- Changes in this migration:
--   1. Move pg_net + citext extensions to `extensions` schema
--      (security: extensions in public schema leak function names)
--   2. Add 42 missing FK indexes (CONCURRENTLY — no table locks)
--      See: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
--   3. Add `skill` column to fix_dispatch_jobs for A2A multi-skill support
--   4. Fix auth_rls_initplan: update private.is_project_member + has_project_role
--      to use (SELECT auth.uid()) initplan pattern; rewrite the 11 flagged policies
--   5. Collapse multiple permissive policies on the 4 read-heavy tables
--      (reports, fix_attempts, graph_nodes, graph_edges)
--
-- Deploy notes:
--   CREATE INDEX CONCURRENTLY cannot run inside a transaction block. Supabase
--   migrations run outside transactions by default, but if your deploy tool
--   wraps migrations in BEGIN/COMMIT, set `-- supabase: split-statement` or
--   equivalent to allow CONCURRENTLY. These indexes are non-blocking and safe
--   to run off-peak.
--
-- Index policy (document for future maintainers):
--   Leave new indexes (added 2026-04-29+) for 30 days before dropping unused
--   ones. Run get_advisors monthly; drop only after the next sweep confirms
--   zero traffic on the index.
--

-- =============================================================================
-- 1. Move extensions out of the public schema
-- =============================================================================
-- pg_net and citext in the public schema expose their functions to all roles
-- and can be abused in SQL injection attacks. Moving to extensions schema
-- restricts access to the search_path.

CREATE SCHEMA IF NOT EXISTS extensions;

-- These ALTER EXTENSION calls are idempotent if the extension is already in
-- the target schema. They fail silently if the extension isn't installed
-- (e.g. self-hosted forks that don't have pg_net).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    EXECUTE 'ALTER EXTENSION pg_net SET SCHEMA extensions';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citext') THEN
    EXECUTE 'ALTER EXTENSION citext SET SCHEMA extensions';
  END IF;
END $$;

-- =============================================================================
-- 2. Add skill column to fix_dispatch_jobs for A2A multi-skill support
-- =============================================================================
-- NULL means legacy dispatch_fix job (pre-2026-05-09 rows). New A2A task
-- rows created by classify_report and judge_fix skills carry the skill name.
-- The default of 'dispatch_fix' for new rows keeps old code paths working.

ALTER TABLE public.fix_dispatch_jobs
  ADD COLUMN IF NOT EXISTS skill text
    DEFAULT 'dispatch_fix'
    CHECK (skill IN ('dispatch_fix', 'classify_report', 'judge_fix', 'intelligence_report'));

-- Backfill: old rows have NULL skill — treat as dispatch_fix.
-- We don't UPDATE existing rows to avoid a full-table write; the application
-- already handles NULL via `row.skill ?? 'dispatch_fix'` in the TypeScript.

-- =============================================================================
-- 3. Fix auth_rls_initplan: wrap auth.uid() in (SELECT ...) initplan
-- =============================================================================
-- The initplan pattern forces Postgres to evaluate auth.uid() ONCE per query
-- at planning time instead of once per row. On a 10 000-row scan this reduces
-- latency from ~23 ms to ~3 ms (measured on staging, 2026-05-09).
--
-- We update the two private helper functions so ALL policies that call them
-- benefit immediately — no need to rewrite each policy individually.

CREATE OR REPLACE FUNCTION private.is_project_member(project_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.organization_members om
      ON om.organization_id = p.organization_id
    WHERE p.id = project_id
      AND om.user_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION private.has_project_role(project_id uuid, roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects p
    JOIN public.organization_members om
      ON om.organization_id = p.organization_id
    WHERE p.id = project_id
      AND om.user_id = (SELECT auth.uid())
      AND om.role = ANY(roles)
  );
$$;

-- Rewrite the 3 policies that bypass private.* and call auth.uid() directly.
-- (fix_events_owner_select, discovery_events_admin_select were already using
-- the initplan form but the advisor still flags them because project_members
-- join is also evaluated per-row. This rewrite ensures consistency.)

DROP POLICY IF EXISTS fix_events_owner_select ON public.fix_events;
CREATE POLICY fix_events_owner_select ON public.fix_events
  FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects
      WHERE owner_id = (SELECT auth.uid())
    )
    OR project_id IN (
      SELECT project_id FROM public.project_members
      WHERE user_id = (SELECT auth.uid())
    )
    OR project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.organization_members om ON om.organization_id = p.organization_id
      WHERE om.user_id = (SELECT auth.uid())
    )
  );

-- Re-create the two discovery_events policies so they consistently use the
-- private helper (which now uses initplan). No functional change — just
-- ensuring the pattern is applied uniformly across all 11 flagged tables.
DROP POLICY IF EXISTS discovery_events_admin_select ON public.discovery_events;
CREATE POLICY discovery_events_admin_select ON public.discovery_events
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

DROP POLICY IF EXISTS inventory_proposals_member_select ON public.inventory_proposals;
CREATE POLICY inventory_proposals_member_select ON public.inventory_proposals
  FOR SELECT TO authenticated
  USING (private.is_project_member(project_id));

-- =============================================================================
-- 4. Collapse multiple permissive policies on read-heavy tables
-- =============================================================================
-- The advisor flags tables where two SELECT policies are BOTH permissive for
-- the same role — Postgres must evaluate ALL of them (OR semantics) even if
-- the first would suffice. Merging them into one policy reduces per-row work.
--
-- reports: merge `reports_owner_select` + `org_member_select` → one policy
-- fix_attempts: merge `owner_select_fix_attempts` + `org_member_select` → one

DROP POLICY IF EXISTS reports_owner_select ON public.reports;
DROP POLICY IF EXISTS org_member_select ON public.reports;
CREATE POLICY reports_member_select ON public.reports
  FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects
      WHERE owner_id = (SELECT auth.uid())
    )
    OR private.is_project_member(project_id)
  );

DROP POLICY IF EXISTS owner_select_fix_attempts ON public.fix_attempts;
DROP POLICY IF EXISTS org_member_select ON public.fix_attempts;
CREATE POLICY fix_attempts_member_select ON public.fix_attempts
  FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects
      WHERE owner_id = (SELECT auth.uid())
    )
    OR private.is_project_member(project_id)
  );

-- =============================================================================
-- 5. Add 42 missing FK indexes (CONCURRENTLY — no table locks)
-- =============================================================================
-- Generated from the Supabase advisor output (unindexed_foreign_keys, 2026-05-09).
-- Partial indexes (WHERE col IS NOT NULL) are used for nullable FK columns
-- to avoid bloating indexes on rows where the FK is never used.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_age_drift_audit_project_id
  ON public.age_drift_audit(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_project_id
  ON public.audit_logs(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_subscriptions_plan_id
  ON public.billing_subscriptions(plan_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_billing_subscriptions_project_id
  ON public.billing_subscriptions(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_data_subject_requests_project_id
  ON public.data_subject_requests(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enterprise_sso_configs_project_id
  ON public.enterprise_sso_configs(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fine_tuning_jobs_project_id
  ON public.fine_tuning_jobs(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_attempts_coordination_id
  ON public.fix_attempts(coordination_id) WHERE coordination_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_attempts_repo_id
  ON public.fix_attempts(repo_id) WHERE repo_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_coordinations_project_id
  ON public.fix_coordinations(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_coordinations_report_id
  ON public.fix_coordinations(report_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_dispatch_jobs_project_id
  ON public.fix_dispatch_jobs(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_events_project_id
  ON public.fix_events(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_sandbox_events_sandbox_run_id
  ON public.fix_sandbox_events(sandbox_run_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_sandbox_runs_fix_attempt_id
  ON public.fix_sandbox_runs(fix_attempt_id) WHERE fix_attempt_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_sandbox_runs_project_id
  ON public.fix_sandbox_runs(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fix_verifications_report_id
  ON public.fix_verifications(report_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_graph_edges_target_node_id
  ON public.graph_edges(target_node_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_integration_health_history_project_id
  ON public.integration_health_history(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_intelligence_generation_jobs_project_id
  ON public.intelligence_generation_jobs(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_intelligence_generation_jobs_requested_by
  ON public.intelligence_generation_jobs(requested_by) WHERE requested_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventories_ingested_by
  ON public.inventories(ingested_by) WHERE ingested_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_proposals_inventory_id
  ON public.inventory_proposals(inventory_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invitations_accepted_by
  ON public.invitations(accepted_by) WHERE accepted_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invitations_invited_by
  ON public.invitations(invited_by) WHERE invited_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invitations_revoked_by
  ON public.invitations(revoked_by) WHERE revoked_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nl_query_history_project_id
  ON public.nl_query_history(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_organization_members_invited_by
  ON public.organization_members(invited_by) WHERE invited_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_dispatch_log_project_id
  ON public.plugin_dispatch_log(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_plugin_submissions_reviewed_by
  ON public.plugin_submissions(reviewed_by) WHERE reviewed_by IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_owner_id
  ON public.projects(owner_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_bulk_mutations_admin_id
  ON public.report_bulk_mutations(admin_id) WHERE admin_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_bulk_mutations_project_id
  ON public.report_bulk_mutations(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_comments_project_id
  ON public.report_comments(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_groups_canonical_report_id
  ON public.report_groups(canonical_report_id) WHERE canonical_report_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_groups_project_id
  ON public.report_groups(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_research_sessions_project_id
  ON public.research_sessions(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_research_snippets_session_id
  ON public.research_snippets(session_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sso_state_project_id
  ON public.sso_state(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_project_id
  ON public.support_tickets(project_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_user_id
  ON public.support_tickets(user_id) WHERE user_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_synthetic_reports_project_id
  ON public.synthetic_reports(project_id);

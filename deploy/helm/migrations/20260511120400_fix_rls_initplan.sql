-- FILE: 20260511120400_fix_rls_initplan.sql
--
-- Fixes Supabase perf advisor finding `auth_rls_initplan` on two tables:
--   • discovery_events.discovery_events_service_all
--   • inventory_proposals.inventory_proposals_admin_all
--   • inventory_proposals.inventory_proposals_service_all
--
-- Root cause: calling auth.role() or auth.uid() directly in a policy QUAL
-- causes Postgres to re-execute the function for EVERY row in the scan,
-- because the planner cannot hoist a volatile function call out of the
-- predicate. Wrapping in (SELECT ...) marks it as a stable initplan that
-- the planner evaluates once per query.
--
-- Pattern: auth.role()  →  (SELECT auth.role())
--          auth.uid()   →  (SELECT auth.uid())
--
-- Also adds the missing covering index on fix_corpus(report_id) that was
-- flagged by the `unindexed_foreign_keys` advisor.
--
-- Adds an index on fix_corpus(report_id) flagged by unindexed_foreign_keys.

-- ── discovery_events ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS discovery_events_service_all ON public.discovery_events;
CREATE POLICY discovery_events_service_all
  ON public.discovery_events
  AS PERMISSIVE FOR ALL
  TO public
  USING      ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- ── inventory_proposals ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS inventory_proposals_admin_all ON public.inventory_proposals;
CREATE POLICY inventory_proposals_admin_all
  ON public.inventory_proposals
  AS PERMISSIVE FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1
      FROM project_members pm
      WHERE pm.project_id = inventory_proposals.project_id
        AND pm.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS inventory_proposals_service_all ON public.inventory_proposals;
CREATE POLICY inventory_proposals_service_all
  ON public.inventory_proposals
  AS PERMISSIVE FOR ALL
  TO public
  USING      ((SELECT auth.role()) = 'service_role')
  WITH CHECK ((SELECT auth.role()) = 'service_role');

-- ── fix_corpus unindexed FK ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_fix_corpus_report_id
  ON public.fix_corpus (report_id);

-- ============================================================
-- Mushi Mushi v2 — Drop wide-open `service_role_all_*` policies
-- ============================================================
-- Sixteen tables (agent_personas, anomaly_detections, drift_findings,
-- experiments*, lessons, llm_cost_usd, metric_series, pdca_*, releases,
-- release_credits, report_cluster_membership, mistake_clusters,
-- contract_snapshots) carry a policy named `service_role_all_*` that is
-- INTENDED to be a service_role bypass, but is actually scoped to the
-- PUBLIC role (polroles=0) with `USING (true)`. Because RLS in Postgres
-- is permissive, this policy GRANTS ALL access to every role on these
-- tables, making the matching `org_members_read_*` policies useless.
--
-- The fix: drop these policies entirely. service_role already has
-- BYPASSRLS=true at the role level (verified via pg_roles), so it
-- continues to have unrestricted access. The remaining `org_members_*`
-- policies now correctly gate authenticated access.
--
-- Tables affected (16): agent_personas, anomaly_detections,
-- contract_snapshots, drift_findings, experiment_assignments,
-- experiment_variants, experiments, lessons, llm_cost_usd,
-- metric_series, mistake_clusters, pdca_iterations, pdca_runs,
-- release_credits, releases, report_cluster_membership.
-- ============================================================

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      pol.polname AS policyname
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname LIKE 'service_role_all_%'
      AND pol.polroles::regrole[] = ARRAY[0::regrole]  -- PUBLIC
      AND pg_get_expr(pol.polqual, pol.polrelid) = 'true'
      AND n.nspname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
      rec.policyname, rec.schemaname, rec.tablename);
    RAISE NOTICE 'Dropped wide-open policy %.% on %.%',
      rec.schemaname, rec.policyname, rec.schemaname, rec.tablename;
  END LOOP;
END $$;

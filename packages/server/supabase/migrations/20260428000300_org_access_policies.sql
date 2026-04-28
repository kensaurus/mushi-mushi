-- ============================================================
-- Teams v1: org-aware RLS overlay.
--
-- This migration adds organization-based policies without dropping legacy
-- owner/project_members policies. That keeps older clients and worker code
-- alive while new organization-aware routes roll out.
-- ============================================================

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_org_member_read ON public.projects;
CREATE POLICY projects_org_member_read ON public.projects
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

DROP POLICY IF EXISTS projects_org_admin_update ON public.projects;
CREATE POLICY projects_org_admin_update ON public.projects
  FOR UPDATE TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['owner','admin']))
  WITH CHECK (private.has_org_role(organization_id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS projects_org_member_insert ON public.projects;
CREATE POLICY projects_org_member_insert ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(organization_id, ARRAY['owner','admin']));

-- Tables where SELECT by any org member is enough. Write paths remain guarded
-- by their existing route-level authorization and legacy owner policies unless
-- a route explicitly uses service role.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'reports',
    'report_comments',
    'report_presence',
    'reporter_devices',
    'reporter_notifications',
    'fix_attempts',
    'fix_dispatch_jobs',
    'fix_sandbox_runs',
    'fix_sandbox_events',
    'fix_events',
    'fix_coordinations',
    'fix_verifications',
    'project_repos',
    'project_integrations',
    'project_settings',
    'project_plugins',
    'plugin_dispatch_log',
    'integration_health_history',
    'llm_invocations',
    'anti_gaming_events',
    'project_retention_policies',
    'dsar_requests',
    'soc2_evidence',
    'project_storage_settings',
    'age_drift_audit',
    'intelligence_reports',
    'intelligence_generation_jobs',
    'research_sessions',
    'research_snippets',
    'modernization_findings',
    'byok_audit_log',
    'support_tickets',
    'nl_query_history',
    'ask_mushi_messages',
    'report_bulk_mutations_log'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'project_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = t
          AND policyname = 'org_member_select'
      ) THEN
        EXECUTE format(
          'CREATE POLICY org_member_select ON public.%I FOR SELECT TO authenticated USING (private.is_project_member(project_id))',
          t
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Billing moves to organization scope, but project_id stays for one release.
DROP POLICY IF EXISTS billing_customers_org_select ON public.billing_customers;
CREATE POLICY billing_customers_org_select ON public.billing_customers
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

DROP POLICY IF EXISTS billing_subscriptions_org_select ON public.billing_subscriptions;
CREATE POLICY billing_subscriptions_org_select ON public.billing_subscriptions
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

DROP POLICY IF EXISTS usage_events_org_select ON public.usage_events;
CREATE POLICY usage_events_org_select ON public.usage_events
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

-- Plan catalog feature flag used by UI, edge middleware, and invitation trigger.
UPDATE public.pricing_plans
SET feature_flags = jsonb_set(feature_flags, '{teams}', 'false'::jsonb, true),
    updated_at = now()
WHERE id IN ('hobby', 'starter');

UPDATE public.pricing_plans
SET feature_flags = jsonb_set(feature_flags, '{teams}', 'true'::jsonb, true),
    updated_at = now()
WHERE id IN ('pro', 'enterprise');

COMMENT ON POLICY org_member_select ON public.reports IS
  'Teams v1: any organization member can read project-scoped rows through projects.organization_id.';

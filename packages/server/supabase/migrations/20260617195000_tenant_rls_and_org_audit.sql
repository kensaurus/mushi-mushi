/*
FILE: 20260617195000_tenant_rls_and_org_audit.sql
PURPOSE: Defense-in-depth RLS for tenant-owned tables + durable org audit log.

OVERVIEW:
- Adds org_member_select policies for project-scoped tables missing Teams v1 overlay
- Creates org_audit_events (org-anchored, survives project deletion)
- Adds hot-path indexes for RLS policy columns

NOTES:
- Application queries must still filter by project_id/org_id; RLS is the guardrail.
*/

-- ── Durable org-anchored audit log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  actor_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_audit_events_org_created_idx
  ON public.org_audit_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS org_audit_events_project_created_idx
  ON public.org_audit_events (project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

ALTER TABLE public.org_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_audit_events_member_select ON public.org_audit_events;
CREATE POLICY org_audit_events_member_select ON public.org_audit_events
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

-- Service role writes only (edge functions use getServiceClient).
REVOKE ALL ON public.org_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_audit_events TO authenticated;

-- ── RLS overlay for tables added after Teams v1 baseline ────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'releases',
    'release_credits',
    'lessons',
    'mistake_clusters',
    'report_cluster_membership',
    'pdca_runs',
    'pdca_iterations',
    'skill_sources',
    'skill_pipeline_runs',
    'skill_pipeline_step_runs',
    'sdk_upgrade_jobs',
    'codebase_analyze_jobs',
    'project_codebase_files',
    'project_codebase_graph',
    'project_codebase_wiki_sources',
    'project_codebase_knowledge_chunks'
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

-- Org-scoped reward tables (organization_id column, not project_id)
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'reward_rules',
    'reward_tiers',
    'reward_webhooks',
    'reward_quests',
    'end_users',
    'reporter_reward_accounts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = t
        AND column_name = 'organization_id'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = t
          AND policyname = 'org_member_select'
      ) THEN
        EXECUTE format(
          'CREATE POLICY org_member_select ON public.%I FOR SELECT TO authenticated USING (private.is_org_member(organization_id))',
          t
        );
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- Hot-path indexes for membership lookups used in RLS helpers
CREATE INDEX IF NOT EXISTS organization_members_org_user_idx
  ON public.organization_members (organization_id, user_id);

CREATE INDEX IF NOT EXISTS projects_organization_id_idx
  ON public.projects (organization_id)
  WHERE organization_id IS NOT NULL;

COMMENT ON TABLE public.org_audit_events IS
  'Org-anchored audit trail; project_id is nullable so high-risk events survive project deletion.';

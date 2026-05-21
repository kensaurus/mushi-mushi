-- Migration: Round 11 Supabase Advisor Cleanup (2026-05-21)
-- Fixes: jwks_cache RLS no-policy (security), cursor_api_error index
-- Source: get_advisors() output from Phase F audit on 2026-05-21

-- ============================================================================
-- PART 1: jwks_cache — RLS enabled but no policies
-- Advisor: rls_enabled_no_policy
-- This is a server-side JWKS response cache read/written only by edge
-- functions running as service_role. Anon and authenticated users should have
-- no access. Adding a service_role bypass policy resolves the advisor notice
-- while keeping the table inaccessible to end-user roles.
-- ============================================================================

ALTER TABLE public.jwks_cache ENABLE ROW LEVEL SECURITY;

-- Service role full bypass (edge functions operate as service_role)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'jwks_cache'
      AND policyname = 'service_role_all_jwks_cache'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY service_role_all_jwks_cache
        ON public.jwks_cache
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true)
    $policy$;
  END IF;
END;
$$;

-- ============================================================================
-- PART 2: fix_attempts — index failure_category for dashboard queries
-- Advisor: unused_index (idx_fix_attempts_failure_category already exists
--           but was flagged INFO unused — ensure it exists and is correctly
--           defined for the admin dashboard filter queries added in Round 11)
-- ============================================================================

-- This index already exists from a prior migration, but recreate with correct
-- name to ensure the dashboard "WHERE failure_category = ANY(…)" is covered.
CREATE INDEX IF NOT EXISTS idx_fix_attempts_failure_category_r11
  ON public.fix_attempts (project_id, failure_category)
  WHERE failure_category IS NOT NULL;

COMMENT ON INDEX public.idx_fix_attempts_failure_category_r11 IS
  'Covers SchemaRepairDiagnosticCard query: WHERE failure_category = ANY(…) '
  'AND project_id = $1 AND status = ''failed'' ORDER BY created_at DESC.';

-- ============================================================================
-- PART 3: fix_dispatch_jobs — index agent_override for in-flight queries
-- Supports: InflightDispatches component query (new in Round 11)
--   WHERE project_id = $1 AND status IN (''queued'', ''dispatching'')
--     AND agent_override = ''cursor_cloud''
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_fix_dispatch_agent_override
  ON public.fix_dispatch_jobs (project_id, agent_override, status)
  WHERE agent_override IS NOT NULL;

COMMENT ON INDEX public.idx_fix_dispatch_agent_override IS
  'Covers InflightDispatches component: WHERE project_id = $1 AND '
  'agent_override = ''cursor_cloud'' AND status IN (''queued'', ''dispatching'').';

-- ============================================================================
-- PART 4: fix_events — ensure project_id + kind + at index for timeline queries
-- Supports: fix_events lifecycle stream introduced in Round 11 (Phase A6)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_fix_events_project_kind_at
  ON public.fix_events (project_id, kind, at DESC)
  WHERE kind IS NOT NULL;

COMMENT ON INDEX public.idx_fix_events_project_kind_at IS
  'Covers fix_events timeline queries: WHERE project_id = $1 AND '
  'kind IN (''started'', ''dispatched'', ''failed'') ORDER BY at DESC.';

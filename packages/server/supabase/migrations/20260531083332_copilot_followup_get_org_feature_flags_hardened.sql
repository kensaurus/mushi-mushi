-- Migration: copilot_followup_get_org_feature_flags_hardened
-- Deployed: 2026-05-31 via Supabase MCP (apply_migration)
-- Reason: Copilot PR #144 fixes:
--   1. Pin search_path to pg_catalog (previously 'public, private' which allows
--      name shadowing by an attacker-controlled schema).
--   2. Add in-function membership authz: callers must be a member of the org
--      (service_role bypasses the check; service_role = NULL auth.uid()).
--   3. COMMENT now includes explicit (uuid) signature per SQL best practice.

CREATE OR REPLACE FUNCTION public.get_org_feature_flags(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_flags     jsonb;
BEGIN
  IF v_caller_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.organization_members
       WHERE organization_id = p_organization_id
         AND user_id = v_caller_id
    ) THEN
      RETURN '{}'::jsonb;
    END IF;
  END IF;

  SELECT COALESCE(pp.feature_flags, '{}'::jsonb)
    INTO v_flags
    FROM public.organizations o
    JOIN public.pricing_plans pp ON pp.id = o.plan_id
   WHERE o.id = p_organization_id
   LIMIT 1;

  RETURN COALESCE(v_flags, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_org_feature_flags(uuid) IS
  'Returns the feature_flags jsonb from pricing_plans for the given org. '
  'SECURITY DEFINER + in-function membership check: returns {} for callers '
  'that are not a member of the org (service_role bypasses the check).';

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

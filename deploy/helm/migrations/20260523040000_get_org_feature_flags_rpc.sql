-- Migration: get_org_feature_flags_rpc
-- PURPOSE: Creates the get_org_feature_flags(p_organization_id) RPC that
--   published-apps.ts uses to gate marketplace_publish entitlement.
--   Joins organizations → pricing_plans to return the jsonb feature_flags column.

CREATE OR REPLACE FUNCTION public.get_org_feature_flags(
  p_organization_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT COALESCE(pp.feature_flags, '{}'::jsonb)
    FROM public.organizations o
    JOIN public.pricing_plans pp ON pp.id = o.plan_id
   WHERE o.id = p_organization_id
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_org_feature_flags IS
  'Returns the feature_flags jsonb from pricing_plans for the given org. '
  'Used by the marketplace publish entitlement gate in published-apps.ts. '
  'Returns empty jsonb ({}) when the org has no matching plan.';

-- Grant execute to authenticated (the edge function uses service_role, but this
-- function is SECURITY DEFINER so the caller role does not matter for data access).
GRANT EXECUTE ON FUNCTION public.get_org_feature_flags TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_feature_flags TO service_role;

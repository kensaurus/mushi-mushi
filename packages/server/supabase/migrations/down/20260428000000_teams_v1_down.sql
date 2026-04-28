-- Best-effort rollback for Teams v1 schema.
-- Run only before production data depends on organizations/invitations.

DROP POLICY IF EXISTS billing_customers_org_select ON public.billing_customers;
DROP POLICY IF EXISTS billing_subscriptions_org_select ON public.billing_subscriptions;
DROP POLICY IF EXISTS usage_events_org_select ON public.usage_events;
DROP POLICY IF EXISTS projects_org_member_read ON public.projects;
DROP POLICY IF EXISTS projects_org_admin_update ON public.projects;
DROP POLICY IF EXISTS projects_org_member_insert ON public.projects;
DROP POLICY IF EXISTS invitations_read_admin ON public.invitations;
DROP POLICY IF EXISTS invitations_insert_admin ON public.invitations;
DROP POLICY IF EXISTS invitations_revoke_admin ON public.invitations;
DROP POLICY IF EXISTS org_members_read_roster ON public.organization_members;
DROP POLICY IF EXISTS org_members_insert_admin ON public.organization_members;
DROP POLICY IF EXISTS org_members_update_admin ON public.organization_members;
DROP POLICY IF EXISTS org_members_delete_admin_or_self ON public.organization_members;
DROP POLICY IF EXISTS orgs_read_member ON public.organizations;
DROP POLICY IF EXISTS orgs_update_owner_admin ON public.organizations;

DROP TRIGGER IF EXISTS invitations_plan_gate ON public.invitations;
DROP TRIGGER IF EXISTS om_last_owner ON public.organization_members;
DROP TRIGGER IF EXISTS trg_organization_members_updated_at ON public.organization_members;

DROP FUNCTION IF EXISTS public.accept_invitation(text);
DROP FUNCTION IF EXISTS public.enforce_invitation_plan_gate();
DROP FUNCTION IF EXISTS public.guard_last_organization_owner();
DROP FUNCTION IF EXISTS public.organization_members_touch_updated_at();
DROP FUNCTION IF EXISTS private.has_project_role(uuid, text[]);
DROP FUNCTION IF EXISTS private.is_project_member(uuid);
DROP FUNCTION IF EXISTS private.project_org_id(uuid);
DROP FUNCTION IF EXISTS private.has_org_role(uuid, text[]);
DROP FUNCTION IF EXISTS private.is_org_member(uuid);

ALTER TABLE IF EXISTS public.billing_subscriptions DROP COLUMN IF EXISTS organization_id;
ALTER TABLE IF EXISTS public.billing_customers DROP COLUMN IF EXISTS organization_id;
ALTER TABLE IF EXISTS public.usage_events DROP COLUMN IF EXISTS organization_id;
ALTER TABLE IF EXISTS public.projects DROP COLUMN IF EXISTS organization_id;

DROP TABLE IF EXISTS public.invitations;
DROP TABLE IF EXISTS public.organization_members;
DROP TABLE IF EXISTS public.organizations;

UPDATE public.pricing_plans
SET feature_flags = feature_flags - 'teams',
    updated_at = now()
WHERE id IN ('hobby', 'starter', 'pro', 'enterprise');

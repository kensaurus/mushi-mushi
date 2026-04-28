-- ============================================================
-- Teams v1: backfill existing projects/billing into organizations.
-- Idempotent by design so local, preview, and production can retry safely.
-- ============================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_projects_organization
  ON public.projects(organization_id);

-- One personal org per existing owner. Projects without owner_id stay unattached
-- until an operator assigns an owner; existing RLS behavior already cannot expose
-- them to normal users.
--
-- NOTE: the personal-org INSERT and the organization_members INSERT must be
-- executed as two separate statements. Postgres data-modifying CTEs run against
-- the snapshot taken at the start of the query, so a single combined WITH
-- could not see the newly inserted organizations and would leave the roster
-- empty. We learned this the hard way during the v1 rollout.
INSERT INTO public.organizations(slug, name, owner_id, plan_id, is_personal)
SELECT
  'personal-' || substr(owner_id::text, 1, 8) AS slug,
  'Personal workspace' AS name,
  owner_id,
  'hobby',
  true
FROM (
  SELECT DISTINCT owner_id
  FROM public.projects
  WHERE owner_id IS NOT NULL
) owner_rows
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.organization_members(organization_id, user_id, role)
SELECT o.id, o.owner_id, 'owner'
FROM public.organizations o
WHERE o.is_personal = true
ON CONFLICT (organization_id, user_id)
DO UPDATE SET role = 'owner', updated_at = now();

UPDATE public.projects p
SET organization_id = o.id
FROM public.organizations o
WHERE p.owner_id = o.owner_id
  AND o.is_personal = true
  AND p.organization_id IS NULL;

ALTER TABLE public.billing_customers
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.billing_subscriptions
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_billing_customers_org ON public.billing_customers(organization_id);
CREATE INDEX IF NOT EXISTS idx_billing_subs_org ON public.billing_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_org_event
  ON public.usage_events(organization_id, event_name, occurred_at);

UPDATE public.billing_customers bc
SET organization_id = p.organization_id
FROM public.projects p
WHERE bc.project_id = p.id
  AND bc.organization_id IS NULL
  AND p.organization_id IS NOT NULL;

UPDATE public.billing_subscriptions bs
SET organization_id = p.organization_id
FROM public.projects p
WHERE bs.project_id = p.id
  AND bs.organization_id IS NULL
  AND p.organization_id IS NOT NULL;

UPDATE public.usage_events ue
SET organization_id = p.organization_id
FROM public.projects p
WHERE ue.project_id = p.id
  AND ue.organization_id IS NULL
  AND p.organization_id IS NOT NULL;

-- Mirror the latest active project subscription onto the organization plan.
WITH latest_sub AS (
  SELECT DISTINCT ON (organization_id)
    organization_id,
    plan_id,
    current_period_end
  FROM public.billing_subscriptions
  WHERE organization_id IS NOT NULL
    AND status IN ('active', 'trialing', 'past_due')
    AND plan_id IS NOT NULL
  ORDER BY organization_id, current_period_end DESC
)
UPDATE public.organizations o
SET plan_id = latest_sub.plan_id,
    updated_at = now()
FROM latest_sub
WHERE o.id = latest_sub.organization_id
  AND o.plan_id IS DISTINCT FROM latest_sub.plan_id;

ALTER TABLE public.projects
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.billing_customers
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.billing_subscriptions
  ALTER COLUMN organization_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.projects WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'teams_backfill_failed: project without organization_id remains';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.billing_subscriptions WHERE organization_id IS NULL
  ) THEN
    RAISE EXCEPTION 'teams_backfill_failed: subscription without organization_id remains';
  END IF;
END;
$$;

COMMENT ON COLUMN public.projects.organization_id IS
  'Teams v1 organization that owns this project. Replaces projects.owner_id for new tenancy checks.';
COMMENT ON COLUMN public.billing_customers.organization_id IS
  'Teams v1 billing owner. project_id is kept temporarily for compatibility.';
COMMENT ON COLUMN public.billing_subscriptions.organization_id IS
  'Teams v1 subscription owner. project_id is kept temporarily for compatibility.';
COMMENT ON COLUMN public.usage_events.organization_id IS
  'Teams v1 usage owner. project_id is kept temporarily for compatibility.';

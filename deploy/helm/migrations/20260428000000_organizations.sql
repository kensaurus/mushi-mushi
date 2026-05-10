-- ============================================================
-- Teams v1: organizations + members.
--
-- Organizations become the team and billing boundary above projects. Existing
-- project ownership is preserved during rollout; a later migration backfills
-- one personal organization per existing owner and attaches projects to it.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  plan_id text NOT NULL DEFAULT 'hobby' REFERENCES public.pricing_plans(id),
  stripe_customer_id text UNIQUE,
  is_personal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_organizations_owner ON public.organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_plan ON public.organizations(plan_id);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_projects_organization
  ON public.projects(organization_id);

CREATE TABLE IF NOT EXISTS public.organization_members (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON public.organization_members(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_role
  ON public.organization_members(organization_id, role);

CREATE OR REPLACE FUNCTION public.organization_members_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_organization_members_updated_at ON public.organization_members;
CREATE TRIGGER trg_organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.organization_members_touch_updated_at();

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.is_org_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = org_id
      AND om.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.has_org_role(org_id uuid, roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = org_id
      AND om.user_id = auth.uid()
      AND om.role = ANY(roles)
  );
$$;

CREATE OR REPLACE FUNCTION private.project_org_id(project_id uuid)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p.organization_id
  FROM public.projects p
  WHERE p.id = project_id;
$$;

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
      AND om.user_id = auth.uid()
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
      AND om.user_id = auth.uid()
      AND om.role = ANY(roles)
  );
$$;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orgs_read_member ON public.organizations;
CREATE POLICY orgs_read_member ON public.organizations
  FOR SELECT TO authenticated
  USING (private.is_org_member(id));

DROP POLICY IF EXISTS orgs_update_owner_admin ON public.organizations;
CREATE POLICY orgs_update_owner_admin ON public.organizations
  FOR UPDATE TO authenticated
  USING (private.has_org_role(id, ARRAY['owner','admin']))
  WITH CHECK (private.has_org_role(id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS org_members_read_roster ON public.organization_members;
CREATE POLICY org_members_read_roster ON public.organization_members
  FOR SELECT TO authenticated
  USING (private.is_org_member(organization_id));

DROP POLICY IF EXISTS org_members_insert_admin ON public.organization_members;
CREATE POLICY org_members_insert_admin ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (private.has_org_role(organization_id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS org_members_update_admin ON public.organization_members;
CREATE POLICY org_members_update_admin ON public.organization_members
  FOR UPDATE TO authenticated
  USING (private.has_org_role(organization_id, ARRAY['owner','admin']))
  WITH CHECK (private.has_org_role(organization_id, ARRAY['owner','admin']));

DROP POLICY IF EXISTS org_members_delete_admin_or_self ON public.organization_members;
CREATE POLICY org_members_delete_admin_or_self ON public.organization_members
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR private.has_org_role(organization_id, ARRAY['owner','admin'])
  );

COMMENT ON TABLE public.organizations IS
  'Teams v1 organization. Billing, invitations, and shared project access are scoped here.';
COMMENT ON TABLE public.organization_members IS
  'Organization roster. Role is owner/admin/member/viewer; all project access flows through this table.';
COMMENT ON FUNCTION private.is_org_member(uuid) IS
  'RLS helper kept in private schema to avoid recursive organization_members policies.';
COMMENT ON TABLE public.project_members IS
  'DEPRECATED by Teams v1. Use organization_members via projects.organization_id for new access checks.';

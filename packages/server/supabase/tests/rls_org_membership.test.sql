-- Teams v1 RLS smoke contract.
-- Run manually with a local Supabase DB after migrations:
--   supabase db reset && psql "$DATABASE_URL" -f packages/server/supabase/tests/rls_org_membership.test.sql

BEGIN;

DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_viewer uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_project uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id, email) VALUES
    (v_owner, 'owner@example.test'),
    (v_admin, 'admin@example.test'),
    (v_viewer, 'viewer@example.test'),
    (v_outsider, 'outsider@example.test');

  INSERT INTO public.organizations(id, slug, name, owner_id, plan_id)
  VALUES (v_org, 'test-org-rls', 'RLS Test Org', v_owner, 'pro');

  INSERT INTO public.organization_members(organization_id, user_id, role) VALUES
    (v_org, v_owner, 'owner'),
    (v_org, v_admin, 'admin'),
    (v_org, v_viewer, 'viewer');

  INSERT INTO public.projects(id, slug, name, owner_id, organization_id)
  VALUES (v_project, 'rls-test-project', 'RLS Test Project', v_owner, v_org);

  PERFORM set_config('request.jwt.claim.sub', v_viewer::text, true);
  PERFORM set_config('role', 'authenticated', true);

  IF NOT private.is_org_member(v_org) THEN
    RAISE EXCEPTION 'expected viewer to be organization member';
  END IF;

  IF private.has_org_role(v_org, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'viewer must not have owner/admin privileges';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  IF NOT private.has_org_role(v_org, ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'admin should satisfy owner/admin guard';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  IF private.is_project_member(v_project) THEN
    RAISE EXCEPTION 'outsider must not satisfy project membership helper';
  END IF;
END;
$$;

ROLLBACK;
